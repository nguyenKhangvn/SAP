const express = require("express");
const router = express.Router();
const Payment = require("../models/Payment");
const Customer = require("../models/Customer");
const Order = require("../models/Order"); // Add Order model
const mongoose = require("mongoose");
const auth = require('../middleware/auth');

// Bảo vệ tất cả các route thanh toán bằng JWT
router.use(auth);

// Lấy tất cả giao dịch công nợ
router.get("/", async (req, res) => {
  try {
    const payments = await Payment.find()
      .populate("customerId", "name")
      .sort({ date: -1 });
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ghi nhận 1 khoản thanh toán
router.post("/", async (req, res) => {
  try {
    const { customerId, amount, type, note, date } = req.body;
    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ error: "Không tìm thấy khách hàng" });

    const payment = new Payment({
      amount,
      customerId,
      type,
      note,
      date: date || new Date() // Use provided date or current date as default
    });
    await payment.save();

    res.status(201).json({ message: "Ghi nhận thanh toán thành công" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get all payments for a specific customer
router.get("/customer/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;
    
    const payments = await Payment.find({ customerId })
      .sort({ date: -1 });
    
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Record debt payment for a specific order
router.post("/pay-order-debt", async (req, res) => {
  try {
    const { customerId, amount, date, note } = req.body;
    
    if (!customerId || !amount || amount <= 0) {
      return res.status(400).json({ error: "Thiếu thông tin thanh toán" });
    }
    
    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ error: "Không tìm thấy khách hàng" });
    
    // Create payment record
    const payment = new Payment({
      customerId,
      amount,
      type: "debt_collected",
      note: note || `Thanh toán nợ cho đơn hàng`,
      date: date || new Date()
    });
    
    await payment.save();
    
    res.status(201).json({ 
      message: "Đã ghi nhận thanh toán nợ thành công",
      payment
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/v1/pay-order-debt", async (req, res) => {
  try {
    const { payments } = req.body;

    if (!Array.isArray(payments) || payments.length === 0) {
      return res.status(400).json({ error: "Thiếu danh sách thanh toán" });
    }

    const savedPayments = [];

    for (const paymentData of payments) {
      const { customerId, amount, orderId, note, date } = paymentData;

      if (!customerId || !amount || amount <= 0 || !orderId) {
        return res.status(400).json({ error: "Thiếu thông tin thanh toán trong một mục" });
      }

      const customer = await Customer.findById(customerId);
      if (!customer) return res.status(404).json({ error: `Không tìm thấy khách hàng với ID ${customerId}` });

      const payment = new Payment({
        ...paymentData,
        date: date || new Date(),
        type: "debt_collected", // hoặc giữ nguyên nếu cần xác định từ client
      });

      await payment.save();
      savedPayments.push(payment);
    }

    res.status(201).json({
      message: "Đã ghi nhận thanh toán nợ cho nhiều đơn",
      payments: savedPayments
    });

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Thanh toán nhiều đơn hàng cùng lúc
// router.post("/pay-multiple-orders", async (req, res) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     // Frontend sends: customerId, totalAmount, date, paymentMethod, note, payments (array)
//     const { customerId, payments, date, paymentMethod, note } = req.body;

//     // --- Input Validation ---
//     if (!customerId || !payments || !Array.isArray(payments) || payments.length === 0) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(400).json({ error: "Thiếu thông tin thanh toán hoặc danh sách đơn hàng không hợp lệ." });
//     }

//     const customer = await Customer.findById(customerId).session(session); // Use session
//     if (!customer) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(404).json({ error: "Không tìm thấy khách hàng." });
//     }

//     // --- Process each individual payment in the 'payments' array ---
//     const paymentRecords = [];
//     const updatedOrderDetails = [];
//     let totalProcessedAmount = 0;

//     for (const item of payments) {
//       // Validate individual payment item
//       if (!item.orderId || typeof item.amount === 'undefined' || item.amount <= 0) {
//         console.warn(`Skipping invalid payment item: ${JSON.stringify(item)}. Missing orderId or invalid amount.`);
//         continue; // Skip invalid items, don't break transaction
//       }

//       // Find the order by orderId (frontend sends orderId, not orderCode)
//       const order = await Order.findById(item.orderId).session(session); // Use session
//       if (!order) {
//         console.warn(`Skipping payment for non-existent orderId: ${item.orderId}.`);
//         continue; // Skip if order not found
//       }

//       // Only process debt orders
//       // You might also want to check if the `item.amount` doesn't exceed `order.remainingDebt`
//       if (order.status !== "debt" || order.remainingDebt <= 0) {
//         console.warn(`Skipping payment for order ${order.orderCode} (ID: ${order._id}). Status is not 'debt' or no remaining debt.`);
//         continue;
//       }

//       // Ensure payment amount doesn't exceed remaining debt
//       const paymentAmountForOrder = order.remainingDebt;
//       if (order.status !== "debt" || order.remainingDebt <= 0) {
//           console.warn(`Skipping payment for order ${order.orderCode} (ID: ${order._id}). Status is not 'debt' or no remaining debt.`);
//           continue;
//         }



//       // Update order's totalPaid and remainingDebt
//       order.totalPaid += paymentAmountForOrder;
//       order.remainingDebt -= paymentAmountForOrder;

//       // Update order status if fully paid
//       if (order.remainingDebt <= 0) {
//         order.status = "paid";
//       } else {
//         order.status = "debt"; // Ensure it stays 'debt' if not fully paid
//       }

//       await order.save({ session }); // Save updated order within the transaction

//       // Create individual payment record for this order
//       const payment = new Payment({
//         customerId: customer._id,
//         customerName: customer.name, // Add customerName for easier lookup
//         orderId: order._id,
//         orderCode: order.orderCode, // Store orderCode
//         amount: paymentAmountForOrder,
//         type: "debt_collected", // Indicates a collection for a debt order
//         paymentMethod: paymentMethod, // Use the common payment method
//         note: `Thanh toán nợ cho đơn hàng ${order.orderCode}` + (item.note ? ` - ${item.note}` : ''), // Individual note
//         date: date || new Date()
//       });

//       await payment.save({ session });
//       paymentRecords.push(payment);
//       totalProcessedAmount += paymentAmountForOrder; // Sum up actual processed amounts

//       // Add to updated order details for response
//       updatedOrderDetails.push({
//         orderCode: order.orderCode,
//         orderId: order._id,
//         amountPaid: paymentAmountForOrder,
//         newRemainingDebt: order.remainingDebt,
//         newStatus: order.status
//       });
//     }

//     // If no valid payments were processed
//     if (paymentRecords.length === 0) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(400).json({ error: "Không có đơn hàng nợ hợp lệ để thanh toán." });
//     }

//     // Create a summary payment record for the entire batch/single payment
//     // Use totalProcessedAmount which is the sum of successfully updated orders
//     const summaryPayment = new Payment({
//       customerId: customer._id,
//       customerName: customer.name,
//       amount: totalProcessedAmount, // Sum of all processed payments
//       type: "payment", // Indicates a general payment transaction
//       paymentMethod: paymentMethod,
//       note: note || `Thanh toán tổng hợp cho ${paymentRecords.length} đơn hàng`,
//       date: date || new Date()
//     });

//     await summaryPayment.save({ session });

//     // Commit the transaction
//     await session.commitTransaction();
//     session.endSession();

//     res.status(201).json({
//       message: `Đã thanh toán thành công ${paymentRecords.length} đơn hàng với tổng số tiền ${totalProcessedAmount.toLocaleString('vi-VN')} VND.`,
//       summaryPayment: summaryPayment, // Return the summary payment record
//       individualPayments: updatedOrderDetails // Details of each order updated
//     });

//   } catch (err) {
//     await session.abortTransaction();
//     session.endSession();
//     console.error("Lỗi khi xử lý thanh toán hàng loạt:", err);
//     res.status(500).json({ error: "Lỗi máy chủ khi xử lý thanh toán: " + err.message });
//   }
// });

//đơn giản thanh toán nhiều đơn
router.post("/pay-multiple-orders", async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { customerId, customerName, totalAmount, date, paymentMethod, note, payments } = req.body;

    // Kiểm tra đầu vào
    if (!customerId || !Array.isArray(payments) || payments.length === 0 || totalAmount === undefined) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Thiếu customerId, totalAmount hoặc danh sách payments không hợp lệ." });
    }

    const customer = await Customer.findById(customerId).session(session);
    if (!customer) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: "Không tìm thấy khách hàng." });
    }

    const paymentRecords = [];
    const updatedOrderDetails = [];
    const skippedOrders = [];
    let actualProcessedAmount = 0;

    for (const item of payments) {
      const { orderId, amount: paymentItemAmount, note: itemNote, paymentMethod: itemPaymentMethod, date: itemDate } = item;

      const order = await Order.findById(orderId).session(session);
      if (!order) {
        skippedOrders.push({ orderId, reason: "Không tìm thấy đơn hàng." });
        continue;
      }

      if (order.status !== "debt") {
        skippedOrders.push({ orderId, reason: "Đơn hàng không còn nợ hoặc không ở trạng thái nợ." });
        continue;
      }

       console.log(`Debug: orderId=${orderId}, paymentItemAmount=${paymentItemAmount}, order.remainingDebt=${order.remainingDebt}`,
        `order.status=${order.status}, order.totalPaid=${order.totalPaid}, order.amount=${order.amount}`); // Debug log
       

      if (paymentItemAmount !== order.remainingDebt) {
        skippedOrders.push({ orderId, reason: "Số tiền thanh toán không khớp với số nợ còn lại." });
        continue;
      }

      // Tiến hành thanh toán
     // order.status = "paid";
      order.totalPaid += paymentItemAmount;
      order.remainingDebt = 0;
      order.isPaid = true; // Đánh dấu là đã thanh toán
      await order.save({ session });

      const payment = new Payment({
        customerId,
        amount: paymentItemAmount,
        type: "debt_collected",
        paymentMethod: itemPaymentMethod || paymentMethod,
        note: itemNote || `Thanh toán nợ cho đơn hàng ${order._id}`,
        date: itemDate || date || new Date()
      });

      await payment.save({ session });

      paymentRecords.push(payment);
      actualProcessedAmount += paymentItemAmount;

      updatedOrderDetails.push({
        orderId: order._id,
        amountPaid: paymentItemAmount,
        newRemainingDebt: 0,
        status: order.status
      });
    }

    if (paymentRecords.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        error: "Không có đơn hàng nợ hợp lệ để thanh toán hoặc số tiền không đủ.",
        skippedOrders
      });
    }

    // Tạo bản ghi tổng hợp
    const summaryPayment = new Payment({
      customerId,
      customerName: customerName || customer.name,
      amount: actualProcessedAmount,
      type: "payment",
      paymentMethod,
      note: note || `Thanh toán tổng hợp cho ${paymentRecords.length} đơn hàng.`,
      date: date || new Date()
    });

    await summaryPayment.save({ session });

    if (actualProcessedAmount !== totalAmount) {
      console.warn(`⚠️ Tổng tiền trong payload (${totalAmount}) không khớp với thực tế đã xử lý (${actualProcessedAmount}).`);
      // Bạn có thể trả lỗi nếu cần strict hơn
    }

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      message: `Đã thanh toán thành công ${paymentRecords.length} đơn hàng.`,
      totalPaid: actualProcessedAmount,
      summaryPayment,
      updatedOrders: updatedOrderDetails,
      skippedOrders // Gửi về để frontend biết đơn nào bị bỏ qua
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("Lỗi xử lý thanh toán:", err);
    return res.status(500).json({ error: "Lỗi máy chủ khi xử lý thanh toán: " + err.message });
  }
});


module.exports = router;
