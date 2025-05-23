// routes/dashboard.js
const express = require("express");
const router = express.Router();
const auth = require('../middleware/auth');

// Models
const Order = require("../models/Order");
const Customer = require("../models/Customer");
const Product = require("../models/Product");
const Payment = require("../models/Payment");
const OrderDetail = require("../models/OrderDetail");
const StockMovement = require("../models/StockMovement");

// Protect all dashboard routes
router.use(auth);

// Helper functions
const getDateRange = () => {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 30);
  return { startDate, endDate };
};

const getProfitStats = async (startDate, endDate) => {
  const orderDetails = await OrderDetail.aggregate([
    {
      $lookup: {
        from: "orders",
        localField: "orderId",
        foreignField: "_id",
        as: "order"
      }
    },
    { $unwind: "$order" },
    {
      $match: {
        "order.date": { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        totalProfit: { $sum: "$profit" }
      }
    }
  ]);

  return {
    totalProfit: orderDetails.length > 0 ? orderDetails[0].totalProfit : 0
  };
};

const getOrderStats = async () => {
  const [
    totalOrders,
    paidOrdersCount,
    debtOrdersCount,
    recentOrders,
    allOrders
  ] = await Promise.all([
    Order.countDocuments(),
    Order.countDocuments({ status: "paid" }),
    Order.countDocuments({ status: "debt" }),
    Order.find().sort({ date: -1 }).limit(5).populate("customerId", "name"),
    Order.find().sort({ date: -1 }).populate("customerId", "name")
  ]);

  return {
    totalOrders,
    paidOrdersCount,
    debtOrdersCount,
    recentOrders,
    allOrders
  };
};

const getRevenueStats = async (startDate, endDate) => {
  const orders = await Order.find({ date: { $gte: startDate, $lte: endDate } });

  const totalRevenue = orders.reduce((sum, order) => sum + (order.total || 0), 0);

  const totalDebtAgg = await Order.aggregate([
    { $match: { isPaid: false } },
    { $group: { _id: null, total: { $sum: "$total" } } },
  ]);

  const totalDebt = totalDebtAgg.length > 0 ? totalDebtAgg[0].total : 0;

  return { totalRevenue, totalDebt };
};

const getTopProducts = async () => {
  return await StockMovement.aggregate([
    { $match: { type: "export" } },
    { $group: { _id: "$productCode", totalQuantity: { $sum: "$quantity" } } },
    { $sort: { totalQuantity: -1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "code",
        as: "productInfo"
      }
    },
    { $unwind: "$productInfo" },
    { $project: { _id: 1, totalQuantity: 1, name: "$productInfo.name" } }
  ]);
};

const getSalesOverTime = async () => {
  const today = new Date();
  const salesData = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(today.getDate() - i);
    const formattedDate = date.toISOString().split("T")[0];

    const startOfDay = new Date(date.setHours(0, 0, 0, 0));
    const endOfDay = new Date(date.setHours(23, 59, 59, 999));

    const dailyOrders = await Order.find({
      date: { $gte: startOfDay, $lte: endOfDay }
    });

    const dailyRevenue = dailyOrders.reduce(
      (sum, order) => sum + (order.total || 0),
      0
    );

    salesData.push({
      date: formattedDate,
      revenue: dailyRevenue,
      orderCount: dailyOrders.length
    });
  }

  return salesData;
};

const getInventoryStats = async () => {
  const products = await Product.find();

  const summary = products.map(product => ({
    productCode: product.code,
    productName: product.name,
    oldStock: product.oldStock,
    imported: product.imported,
    exported: product.exported,
    currentStock: product.newStock,
    stockValue: product.newStock * product.costPrice,
    potentialSaleValue: product.newStock * product.salePrice
  }));

  const lowStockProducts = summary.filter(p => p.currentStock < 10);

  return {
    inventorySummary: summary,
    lowStockProducts,
    totalProductsInStock: summary.filter(p => p.currentStock > 0).length,
    totalOutOfStock: summary.filter(p => p.currentStock <= 0).length,
    totalStockValue: summary.reduce((sum, p) => sum + p.stockValue, 0),
    totalPotentialSaleValue: summary.reduce((sum, p) => sum + p.potentialSaleValue, 0)
  };
};

const getCustomerInsights = async () => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [topCustomers, newCustomers, totalCustomers, customersWithDebt] = await Promise.all([
    Order.aggregate([
      { $group: { _id: "$customerId", totalSpent: { $sum: "$total" }, orderCount: { $sum: 1 } } },
      { $sort: { totalSpent: -1 } },
      { $limit: 5 },
      { $lookup: { from: "customers", localField: "_id", foreignField: "_id", as: "customerInfo" } },
      { $unwind: "$customerInfo" },
      { $project: { _id: 1, name: "$customerInfo.name", totalSpent: 1, orderCount: 1, averageOrderValue: { $divide: ["$totalSpent", "$orderCount"] } } }
    ]),
    Customer.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    Customer.countDocuments(),
    Order.aggregate([
      { $match: { isPaid: false } },
      { $group: { _id: "$customerId", totalDebt: { $sum: "$total" } } },
      { $sort: { totalDebt: -1 } },
      { $limit: 10 },
      { $lookup: { from: "customers", localField: "_id", foreignField: "_id", as: "customerInfo" } },
      { $unwind: "$customerInfo" },
      { $project: { _id: 1, name: "$customerInfo.name", phone: "$customerInfo.phone", totalDebt: 1 } }
    ])
  ]);

  return {
    topCustomers,
    newCustomers,
    customersWithDebt,
    totalCustomers
  };
};

// Routes
router.get("/stats", async (req, res) => {
  try {
    const { startDate, endDate } = getDateRange();

    const [
      orderStats,
      revenueStats,
      topProducts,
      salesOverTime,
      inventoryStats,
      profitStats 
    ] = await Promise.all([
      getOrderStats(),
      getRevenueStats(startDate, endDate),
      getTopProducts(),
      getSalesOverTime(),
      getInventoryStats(),
      getProfitStats(startDate, endDate)
    ]);

    res.json({
      ...orderStats,
      ...revenueStats,
      ...inventoryStats,
      topProducts,
      salesOverTime,
      totalProfit: profitStats.totalProfit
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/inventory", async (req, res) => {
  try {
    const inventoryStats = await getInventoryStats();
    res.json(inventoryStats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/customers", async (req, res) => {
  try {
    const customerInsights = await getCustomerInsights();
    res.json(customerInsights);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;