// API endpoints for debt tracking

const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Payment = require("../models/Payment");
const Customer = require("../models/Customer");
const auth = require("../middleware/auth");

// Protect all routes with JWT authentication
router.use(auth);

// Get debt summary for all customers
router.get("/customer-debts", async (req, res) => {
  try {
    const customers = await Customer.find();
    const debtSummaries = [];
    for (const customer of customers) {
      const orders = await Order.find({
        customerId: customer._id,
        status: "debt",
      });

      const totalOrderValue = orders.reduce(
        (sum, order) => sum + (order.total || 0),
        0
      );

      const payments = await Payment.find({
        customerId: customer._id,
        type: { $in: ["debt_collected"] },
      });

      const totalPayments = payments.reduce(
        (sum, payment) => sum + (payment.amount || 0),
        0
      );

      const newDebts = await Payment.find({
        customerId: customer._id,
        type: "new_debt",
      });

      const totalNewDebts = newDebts.reduce(
        (sum, debt) => sum + (debt.amount || 0),
        0
      );
      const remainingDebt = totalOrderValue - totalPayments;
      if (orders.length > 0 || payments.length > 0) {
        debtSummaries.push({
          customerId: customer._id,
          customerName: customer.name,
          customerPhone: customer.phone,
          totalOrders: orders.length,
          totalOrderValue,
          totalPayments,
          remainingDebt: remainingDebt > 0 ? remainingDebt : 0,
          hasDebt: remainingDebt > 0,
        });
      }
    }
    debtSummaries.sort((a, b) => b.remainingDebt - a.remainingDebt);

    res.json({
      items: debtSummaries,
      totalCustomersWithDebt: debtSummaries.filter((summary) => summary.hasDebt)
        .length,
      totalDebtAmount: debtSummaries.reduce(
        (sum, summary) => sum + summary.remainingDebt,
        0
      ),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get debt details for a specific customer
router.get("/customer-debt/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: "Không tìm thấy khách hàng" });
    }
    const orders = await Order.find({
      customerId,
      isPaid: false,
    });
    const payments = await Payment.find({
      customerId,
      $or: [{ type: "new_debt" }],
    }).sort({ date: -1 });

    const orderDetails = [];
    for (const order of orders) {
      const orderPayments = payments.filter(
        (payment) => payment.note && payment.note.includes(order.orderCode)
      );

      const totalPaid = orderPayments.reduce((sum, payment) => {
        if (payment.type === "payment" || payment.type === "debt_collected") {
          return sum + (payment.amount || 0);
        }
        return sum;
      }, 0);

      const remainingDebt = (order.total || 0) - totalPaid;

      if (remainingDebt > 0) {
        orderDetails.push({
          orderId: order._id,
          orderCode: order.orderCode,
          orderDate: order.date,
          totalAmount: order.total || 0,
          totalPaid,
          remainingDebt,
          isPaid: false,
          status: order.status,
        });
      }
    }

    // Sort by date, newest first
    orderDetails.sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));

    // Calculate overall summary
    const totalOrderValue = orderDetails.reduce(
      (sum, order) => sum + order.totalAmount,
      0
    );
    const totalPaid = orderDetails.reduce(
      (sum, order) => sum + order.totalPaid,
      0
    );
    const totalRemainingDebt = orderDetails.reduce(
      (sum, order) => sum + order.remainingDebt,
      0
    );

    res.json({
      customer: {
        id: customer._id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
      },
      summary: {
        totalOrders: orders.length,
        totalOrderValue,
        totalPaid,
        totalRemainingDebt,
      },
      orders: orderDetails,
      payments: payments.map((payment) => ({
        id: payment._id,
        date: payment.date,
        amount: payment.amount,
        type: payment.type,
        note: payment.note,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get remaining debt for specific orders
router.post("/order-debts", async (req, res) => {
  try {
    const { orderIds } = req.body;

    if (!orderIds || !Array.isArray(orderIds)) {
      return res.status(400).json({ error: "Yêu cầu danh sách ID đơn hàng" });
    }

    const results = [];

    for (const orderId of orderIds) {
      // Get order
      const order = await Order.findById(orderId).populate(
        "customerId",
        "name"
      );
      if (!order) continue;

      // Get payments for this order
      const payments = await Payment.find({
        customerId: order.customerId,
        $or: [
          { note: { $regex: order.orderCode, $options: "i" } },
          { type: "payment" },
        ],
      });

      // Calculate total paid
      const totalPaid = payments.reduce((sum, payment) => {
        if (payment.type === "payment" || payment.type === "debt_collected") {
          return sum + (payment.amount || 0);
        }
        return sum;
      }, 0);

      // Calculate remaining debt
      const remainingDebt = (order.total || 0) - totalPaid;

      results.push({
        orderId: order._id,
        orderCode: order.orderCode,
        orderDate: order.date,
        customerName: order.customerId.name,
        totalAmount: order.total || 0,
        totalPaid: totalPaid > order.total ? order.total : totalPaid,
        remainingDebt: remainingDebt > 0 ? remainingDebt : 0,
        isPaid: remainingDebt <= 0,
      });
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
