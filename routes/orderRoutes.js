const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const OrderDetail = require("../models/OrderDetail");
const StockMovement = require("../models/StockMovement");
const Payment = require("../models/Payment");
const Customer = require("../models/Customer");
const Product = require("../models/Product"); // Add Product model
const auth = require('../middleware/auth');

router.use(auth);

router.post("/", async (req, res) => {
  const session = await Order.startSession();
  session.startTransaction();

  try {
    const { orderCode, customerId, status, items, total } = req.body;

    if (!orderCode || !customerId || !items || items.length === 0) {
      throw new Error("Thiếu thông tin đơn hàng!");
    }

    const customer = await Customer.findById(customerId);
    if (!customer) throw new Error("Không tìm thấy khách hàng!");

    // Tạo đơn hàng chính
    let order;
    if (status === "debt") {
        order = new Order({
        orderCode,
        customerId,
        date: new Date(),
        status,
        total,
        totalIsPaid: 0,
        remainingDebt: total,
        isPaid: false
        }
      );
    } else {
       order = new Order({
        orderCode,
        customerId,
        date: new Date(),
        status,
        total,
        totalIsPaid: total,
        remainingDebt: 0,
        isPaid: true
        }
      );    
    }

    await order.save({ session });

    // Lưu từng sản phẩm chi tiết
    for (const item of items) {
      const product = await Product.findOne({ code: item.productCode });
      if (!product) {
        throw new Error(`Không tìm thấy sản phẩm với mã ${item.productCode}`);
      }
      const costPrice = product.costPrice;
      const amount = item.quantity * item.price;
      const profit = amount - (item.quantity * costPrice);

      await OrderDetail.create([{
        orderId: order._id,
        productCode: item.productCode,
        quantity: item.quantity,
        price: item.price,
        amount,
        profit
      }], { session });

      await StockMovement.create([{
        date: new Date(),
        productCode: item.productCode,
        type: "export",
        quantity: item.quantity,
        note: `Xuất cho đơn hàng ${orderCode}`
      }], { session });
      
      // Cập nhật thông tin tồn kho sản phẩm
      const productToUpdate = await Product.findOne({ code: item.productCode });
      if (productToUpdate) {
        productToUpdate.oldStock = productToUpdate.newStock;
        productToUpdate.exported += item.quantity;
        productToUpdate.newStock -= item.quantity;
        await productToUpdate.save({ session });
      }
    }

    // Nếu là nợ → tạo bản ghi công nợ
    if (status === "debt") {
      await Payment.create([{
        date: new Date(),
        customerId,
        amount: total,
        type: "new_debt",
        note: `Nợ từ đơn hàng ${orderCode}`
      }], { session });
    }

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ message: "Tạo đơn hàng thành công!" });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ error: err.message });
  }
});
//xem tất cả đơn hàng và lấy tên khách hàng
router.get("/", async (req, res) => {
  try {
    const order = await Order.find().populate("customerId", "name")
     .sort({ date: -1 }); 
            
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/:id", async (req, res) => {
  const session = await Order.startSession();
  session.startTransaction();

  try {
    const orderId = req.params.id;

    const order = await Order.findById(orderId).populate("customerId").session(session);
    if (!order) throw new Error("Không tìm thấy đơn hàng!");

    const orderDetails = await OrderDetail.find({ orderId }).session(session);

    for (const detail of orderDetails) {
      const product = await Product.findOne({ code: detail.productCode }).session(session);
      if (product) {
        product.oldStock = product.newStock;
        product.exported -= detail.quantity;
        product.newStock += detail.quantity;
        await product.save({ session });
      }
    }

    await OrderDetail.deleteMany({ orderId }).session(session);
    await Payment.deleteMany({
      customerId: order.customerId._id,
      note: `Nợ từ đơn hàng ${order.orderCode}`
    }).session(session);
    await Order.findByIdAndDelete(orderId).session(session);

    await session.commitTransaction();
    session.endSession();

    res.json({ message: "Đã xóa đơn hàng" });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ error: err.message });
  }
});
// Get a specific order with debt information
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id).populate("customerId", "name");
    
    if (!order) {
      return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
    }
      // Get order details
    const orderDetails = await OrderDetail.find({ orderId: id });
    
    // Lấy thông tin chi tiết của từng sản phẩm
    const detailedProducts = [];
    for (const detail of orderDetails) {
      const product = await Product.findOne({ code: detail.productCode });
      
      detailedProducts.push({
        ...detail.toObject(),
        productName: product ? product.name : "Sản phẩm không tồn tại",
        productDetails: product ? {
          name: product.name,
          costPrice: product.costPrice,
          salePrice: product.salePrice,
          currentStock: product.newStock
        } : null
      });
    }
    
    // Initialize payment variables
    let totalPaid = 0;
    let remainingDebt = 0;
    let payments = [];
    
    // Only process debt information for orders with status "debt"
    if (order.status === "debt") {
      // Get payments related to this order
      payments = await Payment.find({ 
        customerId: order.customerId._id,
        $or: [
          { note: { $regex: order.orderCode, $options: 'i' } },
          { type: "debt_collected" }
        ]
      });
      
      // Calculate total paid for this order
      totalPaid = payments.reduce((sum, payment) => {
        if (payment.type === "payment" || payment.type === "debt_collected") {
          return sum + (payment.amount || 0);
        }
        return sum;
      }, 0);
      
      // Calculate remaining debt
      remainingDebt = (order.total || 0) - totalPaid;
    } 
    
    res.json({
      ...order.toObject(),
      details: detailedProducts,
      payments: payments,
      totalPaid: totalPaid > order.total ? order.total : totalPaid,
      remainingDebt: remainingDebt > 0 ? remainingDebt : 0,
      isPaid: remainingDebt <= 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Chỉnh sửa đơn hàng (thêm, sửa hoặc xóa sản phẩm)
// router.put("/:id", async (req, res) => {
//   const session = await Order.startSession();
//   session.startTransaction();

//   try {
//     const { id } = req.params;
//     const { items, total, status } = req.body;

//     // Kiểm tra đơn hàng tồn tại
//     const order = await Order.findById(id).session(session);
//     if (!order) {
//       throw new Error("Không tìm thấy đơn hàng!");
//     }

//     // Lấy chi tiết đơn hàng hiện tại
//     const currentOrderDetails = await OrderDetail.find({ orderId: id }).session(session);
    
//     // Lưu trữ các mã sản phẩm đã tồn tại để so sánh
//     const existingProductCodes = currentOrderDetails.map(detail => detail.productCode);
//     const newProductCodes = items.map(item => item.productCode);
    
//     // Xử lý các sản phẩm cần xóa khỏi đơn hàng
//     for (const detail of currentOrderDetails) {
//       // Nếu sản phẩm không còn trong danh sách mới, trả lại số lượng vào kho
//       if (!newProductCodes.includes(detail.productCode)) {
//         const product = await Product.findOne({ code: detail.productCode }).session(session);
//         if (product) {
//           product.oldStock = product.newStock;
//           product.exported -= detail.quantity;
//           product.newStock += detail.quantity;
//           await product.save({ session });
//         }
        
//         // Xóa chi tiết đơn hàng
//         await OrderDetail.findByIdAndDelete(detail._id).session(session);
//       }
//     }
    
//     // Xử lý cập nhật số lượng sản phẩm hiện có hoặc thêm sản phẩm mới
//     for (const item of items) {
//       const product = await Product.findOne({ code: item.productCode }).session(session);
//       if (!product) {
//         throw new Error(`Không tìm thấy sản phẩm với mã ${item.productCode}`);
//       }
      
//       const costPrice = product.costPrice;
//       const amount = item.quantity * item.price;
//       const profit = amount - (item.quantity * costPrice);
      
//       // Kiểm tra xem sản phẩm đã tồn tại trong đơn hàng chưa
//       const existingDetail = await OrderDetail.findOne({ 
//         orderId: id, 
//         productCode: item.productCode 
//       }).session(session);
      
//       if (existingDetail) {
//         // Tính toán sự khác biệt về số lượng
//         const quantityDifference = item.quantity - existingDetail.quantity;
        
//         // Cập nhật số lượng trong kho
//         if (quantityDifference !== 0) {
//           product.oldStock = product.newStock;
          
//           if (quantityDifference > 0) {
//             // Nếu số lượng tăng, giảm thêm hàng tồn kho
//             product.exported += quantityDifference;
//             product.newStock -= quantityDifference;
            
//             // Thêm ghi chú di chuyển kho
//             await StockMovement.create([{
//               date: new Date(),
//               productCode: item.productCode,
//               type: "export",
//               quantity: quantityDifference,
//               note: `Cập nhật xuất thêm cho đơn hàng ${order.orderCode}`
//             }], { session });
//           } else {
//             // Nếu số lượng giảm, tăng hàng tồn kho
//             product.exported += quantityDifference; // Quantitydifference is negative here
//             product.newStock -= quantityDifference; // So this adds to newStock
            
//             // Thêm ghi chú di chuyển kho
//             await StockMovement.create([{
//               date: new Date(),
//               productCode: item.productCode,
//               type: "import",
//               quantity: -quantityDifference,
//               note: `Cập nhật nhập lại từ đơn hàng ${order.orderCode}`
//             }], { session });
//           }
          
//           await product.save({ session });
//         }
        
//         // Cập nhật chi tiết đơn hàng
//         existingDetail.quantity = item.quantity;
//         existingDetail.price = item.price;
//         existingDetail.amount = amount;
//         existingDetail.profit = profit;
//         await existingDetail.save({ session });
//       } else {
//         // Thêm sản phẩm mới vào đơn hàng
//         await OrderDetail.create([{
//           orderId: id,
//           productCode: item.productCode,
//           quantity: item.quantity,
//           price: item.price,
//           amount,
//           profit
//         }], { session });
        
//         // Cập nhật số lượng trong kho
//         product.oldStock = product.newStock;
//         product.exported += item.quantity;
//         product.newStock -= item.quantity;
        
//         // Thêm ghi chú di chuyển kho
//         await StockMovement.create([{
//           date: new Date(),
//           productCode: item.productCode,
//           type: "export",
//           quantity: item.quantity,
//           note: `Xuất thêm cho đơn hàng ${order.orderCode}`
//         }], { session });
        
//         await product.save({ session });
//       }
//     }
    
//     // Cập nhật thông tin đơn hàng
//     order.total = total;
    
//     if (status === "debt") {
//       // Nếu chuyển thành đơn nợ
//       if (order.status !== "debt") {
//         // Tạo bản ghi công nợ mới nếu trước đó không phải là đơn nợ
//         await Payment.create([{
//           date: new Date(),
//           customerId: order.customerId,
//           amount: total,
//           type: "new_debt",
//           note: `Nợ từ đơn hàng ${order.orderCode}`
//         }], { session });
        
//         order.status = "debt";
//         order.totalIsPaid = 0;
//         order.remainingDebt = total;
//         order.isPaid = false;
//       } else {
//         // Cập nhật bản ghi công nợ hiện có
//         const existingDebt = await Payment.findOne({ 
//           customerId: order.customerId, 
//           type: "new_debt", 
//           note: `Nợ từ đơn hàng ${order.orderCode}` 
//         }).session(session);
        
//         if (existingDebt) {
//           existingDebt.amount = total;
//           await existingDebt.save({ session });
//         }
        
//         // Tính toán lại số tiền đã trả và số nợ còn lại
//         // const payments = await Payment.find({
//         //   customerId: order.customerId,
//         //   $or: [
//         //     { note: { $regex: order.orderCode, $options: 'i' } },
//         //     { type: "debt_collected" }
//         //   ]
//         // }).session(session);
        
//         // const totalPaid = payments.reduce((sum, payment) => {
//         //   if (payment.type === "payment" || payment.type === "debt_collected") {
//         //     return sum + (payment.amount || 0);
//         //   }
//         //   return sum;
//         // }, 0);
        
//         order.totalIsPaid = 0;
//         order.remainingDebt = 0;
//         order.isPaid = false;
//       }
//     } else {
//       // Nếu chuyển thành đơn trả tiền đầy đủ
//       if (order.status === "debt") {
//         // Xóa bản ghi công nợ nếu trước đó là đơn nợ
//         await Payment.deleteMany({
//           customerId: order.customerId,
//           type: "new_debt",
//           note: `Nợ từ đơn hàng ${order.orderCode}`
//         }).session(session);
//       }
      
//       order.status = "paid";
//       order.totalIsPaid = total;
//       order.remainingDebt = 0;
//       order.isPaid = true;
//     }
    
//     await order.save({ session });
//     await session.commitTransaction();
//     session.endSession();
    
//     res.json({ message: "Cập nhật đơn hàng thành công!" });
//   } catch (err) {
//     await session.abortTransaction();
//     session.endSession();
//     res.status(500).json({ error: err.message });
//   }
// });

// API để xem chi tiết sản phẩm trong một đơn hàng
router.get("/:id/products", async (req, res) => {
  try {
    const { id } = req.params;
    
    // Kiểm tra đơn hàng tồn tại
    const order = await Order.findById(id).populate("customerId", "name");
    if (!order) {
      return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
    }
    
    // Lấy chi tiết đơn hàng
    const orderDetails = await OrderDetail.find({ orderId: id });
    
    // Lấy thông tin chi tiết của từng sản phẩm
    const products = [];
    for (const detail of orderDetails) {
      const product = await Product.findOne({ code: detail.productCode });
      
      products.push({
        orderDetailId: detail._id,
        productCode: detail.productCode,
        productName: product ? product.name : "Sản phẩm không tồn tại",
        quantity: detail.quantity,
        price: detail.price,
        amount: detail.amount,
        profit: detail.profit,
      });
    }
    
    res.json({
      order: {
        _id: order._id,
        orderCode: order.orderCode,
        date: order.date,
        customer: order.customerId,
        status: order.status,
        total: order.total,
        totalIsPaid: order.totalIsPaid,
        remainingDebt: order.remainingDebt,
        isPaid: order.isPaid
      },
      products
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ... (previous code)

router.put("/:id", async (req, res) => {
  const session = await Order.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { items, total, status } = req.body;

    const order = await Order.findById(id).session(session);
    if (!order) {
      throw new Error("Không tìm thấy đơn hàng!");
    }

    const currentOrderDetails = await OrderDetail.find({ orderId: id }).session(session);

    const newProductCodes = items.map(item => item.productCode);

    // --- Step 1: Handle removed products and return to stock ---
    for (const detail of currentOrderDetails) {
      if (!newProductCodes.includes(detail.productCode)) {
        const product = await Product.findOne({ code: detail.productCode }).session(session);
        if (product) {
          product.oldStock = product.newStock;
          product.exported -= detail.quantity;
          product.newStock += detail.quantity;
          await product.save({ session });

          // Record stock movement for items returned from order
          await StockMovement.create([{
            date: new Date(),
            productCode: detail.productCode,
            type: "import", // Because it's coming back into stock
            quantity: detail.quantity,
            note: `Nhập lại từ đơn hàng ${order.orderCode} (sản phẩm đã xóa)`
          }], { session });
        }
        await OrderDetail.findByIdAndDelete(detail._id).session(session);
      }
    }

    // --- Step 2: Handle updated or new products ---
    for (const item of items) {
      const product = await Product.findOne({ code: item.productCode }).session(session);
      if (!product) {
        throw new Error(`Không tìm thấy sản phẩm với mã ${item.productCode}`);
      }

      const costPrice = product.costPrice;
      const amount = item.quantity * item.price;
      const profit = amount - (item.quantity * costPrice);

      const existingDetail = await OrderDetail.findOne({
        orderId: id,
        productCode: item.productCode
      }).session(session);

      if (existingDetail) {
        const quantityDifference = item.quantity - existingDetail.quantity;

        if (quantityDifference !== 0) {
          product.oldStock = product.newStock;

          if (quantityDifference > 0) {
            product.exported += quantityDifference;
            product.newStock -= quantityDifference;
            await StockMovement.create([{
              date: new Date(),
              productCode: item.productCode,
              type: "export",
              quantity: quantityDifference,
              note: `Cập nhật xuất thêm cho đơn hàng ${order.orderCode}`
            }], { session });
          } else { // quantityDifference < 0
            product.exported += quantityDifference; // e.g., exported decreased by 5
            product.newStock -= quantityDifference; // e.g., newStock increased by 5
            await StockMovement.create([{
              date: new Date(),
              productCode: item.productCode,
              type: "import",
              quantity: -quantityDifference, // Make quantity positive for import
              note: `Cập nhật nhập lại từ đơn hàng ${order.orderCode}`
            }], { session });
          }
          await product.save({ session });
        }

        existingDetail.quantity = item.quantity;
        existingDetail.price = item.price;
        existingDetail.amount = amount;
        existingDetail.profit = profit;
        await existingDetail.save({ session });
      } else {
        // New product added to order
        await OrderDetail.create([{
          orderId: id,
          productCode: item.productCode,
          quantity: item.quantity,
          price: item.price,
          amount,
          profit
        }], { session });

        product.oldStock = product.newStock;
        product.exported += item.quantity;
        product.newStock -= item.quantity;
        await StockMovement.create([{
          date: new Date(),
          productCode: item.productCode,
          type: "export",
          quantity: item.quantity,
          note: `Xuất thêm cho đơn hàng ${order.orderCode}`
        }], { session });
        await product.save({ session });
      }
    }

    // --- Step 3: Update Order and Payment Status ---
    order.total = total;

    if (status === "debt") {
      // If the order was fully paid before, or if it's a new debt
      if (order.status !== "debt") {
        await Payment.create([{
          date: new Date(),
          customerId: order.customerId,
          amount: total,
          type: "new_debt",
          note: `Nợ từ đơn hàng ${order.orderCode}`
        }], { session });

        order.status = "debt";
        order.totalIsPaid = 0; // No payments made yet towards this new debt
        order.remainingDebt = total;
        order.isPaid = false;
      } else {
        // It was already a debt order, update the original debt amount if exists
        const existingNewDebtPayment = await Payment.findOne({
          customerId: order.customerId,
          type: "new_debt",
          note: `Nợ từ đơn hàng ${order.orderCode}`
        }).session(session);

        if (existingNewDebtPayment) {
          existingNewDebtPayment.amount = total;
          await existingNewDebtPayment.save({ session });
        } else {
            // This case might happen if the original "new_debt" payment was manually removed,
            // or if the order somehow became 'debt' without a corresponding 'new_debt' payment.
            // Create one to ensure consistency.
             await Payment.create([{
                date: new Date(),
                customerId: order.customerId,
                amount: total,
                type: "new_debt",
                note: `Nợ từ đơn hàng ${order.orderCode}`
            }], { session });
        }

        // Recalculate paid amount and remaining debt for existing debt orders
        const payments = await Payment.find({
          customerId: order.customerId,
          $or: [
            { note: { $regex: order.orderCode, $options: 'i' } }, // Payments specifically for this order's debt
            { type: "debt_collected" } // General debt collections from this customer
          ]
        }).session(session);

        let totalPaidForThisOrder = 0;
        for (const payment of payments) {
            // Be careful to only count payments directly related to this order's debt,
            // or general debt collected that implicitly reduces this order's debt.
            // This logic can be tricky if payments are not explicitly linked to specific orders.
            // For simplicity, we assume payments with order code in note are direct.
            if (payment.type === "payment" || payment.type === "debt_collected" || payment.note.includes(order.orderCode)) {
                totalPaidForThisOrder += payment.amount || 0;
            }
        }
        
        // Ensure totalPaid does not exceed total order value
        order.totalIsPaid = Math.min(totalPaidForThisOrder, total);
        order.remainingDebt = Math.max(0, total - totalPaidForThisOrder);
        order.isPaid = order.remainingDebt <= 0;
      }
    } else { // status === "paid"
      if (order.status === "debt") {
        // If it was a debt order, delete the initial "new_debt" record
        await Payment.deleteMany({
          customerId: order.customerId,
          type: "new_debt",
          note: `Nợ từ đơn hàng ${order.orderCode}`
        }).session(session);

        // Also, any direct payments collected for this specific order debt should be reviewed.
        // If "debt_collected" payments are not linked to specific orders, this might need more complex logic.
        // For now, only deleting the 'new_debt' record.
      }

      order.status = "paid";
      order.totalIsPaid = total;
      order.remainingDebt = 0;
      order.isPaid = true;
    }

    await order.save({ session });
    await session.commitTransaction();
    session.endSession();

    res.json({ message: "Cập nhật đơn hàng thành công!" });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ error: err.message });
  }
});

// ... (remaining code)

module.exports = router;
