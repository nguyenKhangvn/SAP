const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const OrderDetail = require("../models/OrderDetail");
const StockMovement = require("../models/StockMovement");
const Payment = require("../models/Payment");
const Customer = require("../models/Customer");
const Product = require("../models/Product"); // Add Product model

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
      const amount = item.quantity * item.price;

      await OrderDetail.create([{
        orderId: order._id,
        productCode: item.productCode,
        quantity: item.quantity,
        price: item.price,
        amount
      }], { session });

      await StockMovement.create([{
        date: new Date(),
        productCode: item.productCode,
        type: "export",
        quantity: item.quantity,
        note: `Xuất cho đơn hàng ${orderCode}`
      }], { session });
      
      // Cập nhật thông tin tồn kho sản phẩm
      const product = await Product.findOne({ code: item.productCode });
      if (product) {
        product.oldStock = product.newStock;
        product.exported += item.quantity;
        product.newStock -= item.quantity;
        await product.save({ session });
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
    const order = await Order.find().populate("customerId", "name");
    
    // const ordersWithDebt = [];
    //   for (const order of orders) {
    //   let remainingDebt = 0;
      
    //   if (order.status === "debt") {
    //     const payments = await Payment.find({ 
    //       customerId: order.customerId._id,
    //       $or: [
    //         { note: { $regex: order.orderCode, $options: 'i' } },
    //         { type: "debt_collected" }
    //       ]
    //     });
        
    //     let totalPaid = payments.reduce((sum, payment) => {
    //       if (payment.type === "payment" || payment.type === "debt_collected") {
    //         return sum + (payment.amount || 0);
    //       }
    //       return sum;
    //     }, 0);
        
    //     remainingDebt = (order.total || 0) - totalPaid;
    //   }
      
    //   ordersWithDebt.push({
    //     ...order.toObject(),
    //     totalPaid: totalPaid > order.total ? order.total : totalPaid,
    //     remainingDebt: remainingDebt > 0 ? remainingDebt : 0,
    //     isPaid: order.status === "paid" || remainingDebt <= 0
    //   });
    // }
    
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
      details: orderDetails,
      payments: payments,
      totalPaid: totalPaid > order.total ? order.total : totalPaid,
      remainingDebt: remainingDebt > 0 ? remainingDebt : 0,
      isPaid: remainingDebt <= 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
//get all orders of a customer
// router.get("customer/:customerId", async (req, res) => {
//   try {
//     const {customer}
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// })

module.exports = router;
