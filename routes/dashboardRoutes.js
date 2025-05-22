const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Customer = require("../models/Customer");
const Product = require("../models/Product");
const Payment = require("../models/Payment");
const StockMovement = require("../models/StockMovement");

// GET dashboard statistics
router.get("/stats", async (req, res) => {
  try {
    // Get date range (default: last 30 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    // Count metrics
    const totalOrders = await Order.countDocuments();
    const totalCustomers = await Customer.countDocuments();
    const totalProducts = await Product.countDocuments();

    // Revenue metrics
    const orders = await Order.find({
      date: { $gte: startDate, $lte: endDate },
    });

    // Calculate total revenue and debt
    const totalRevenue = orders.reduce(
      (sum, order) => sum + (order.total || 0),
      0
    );
    const totalDebt = await Order.aggregate([
      { $match: { isPaid: false } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]);

    // Recent orders
    const recentOrders = await Order.find()
      .sort({ date: -1 })
      .limit(5)
      .populate("customerId", "name");

    const allOrders = await Order.find()
      .sort({ date: -1 })
      .populate("customerId", "name");

    // Order counts by status
    const paidOrdersCount = await Order.countDocuments({ status: "paid" });
    const debtOrdersCount = await Order.countDocuments({ status: "debt" });

    // Top selling products (based on order details)
    const topProducts = await StockMovement.aggregate([
      { $match: { type: "export" } },
      {
        $group: {
          _id: "$productCode",
          totalQuantity: { $sum: "$quantity" },
        },
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "products", // collection name
          localField: "_id", // _id ở đây là productCode
          foreignField: "code", // field ở products để so sánh
          as: "productInfo",
        },
      },
      { $unwind: "$productInfo" },
      {
        $project: {
          _id: 1,
          totalQuantity: 1,
          name: "$productInfo.name",
        },
      },
    ]);

    // Sales over time (last 7 days)
    const last7Days = [];
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(today.getDate() - i);

      // Format date as YYYY-MM-DD
      const formattedDate = date.toISOString().split("T")[0];

      // Start and end of the day
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));

      // Find orders for this day
      const dailyOrders = await Order.find({
        date: { $gte: startOfDay, $lte: endOfDay },
      });

      // Calculate daily revenue
      const dailyRevenue = dailyOrders.reduce(
        (sum, order) => sum + (order.total || 0),
        0
      );

      last7Days.push({
        date: formattedDate,
        revenue: dailyRevenue,
        orderCount: dailyOrders.length,
      });
    }

    // Calculate total inventory value
    const products = await Product.find();
    const totalInventoryValue = products.reduce(
      (sum, product) => sum + product.newStock * product.costPrice,
      0
    );
    const totalPotentialSaleValue = products.reduce(
      (sum, product) => sum + product.newStock * product.salePrice,
      0
    );

    res.json({
      totalOrders,
      totalCustomers,
      totalProducts,
      totalRevenue,
      totalDebt: totalDebt.length > 0 ? totalDebt[0].total : 0,
      totalInventoryValue,
      totalPotentialSaleValue,
      recentOrders,
      allOrders,
      ordersByStatus: {
        paid: paidOrdersCount,
        debt: debtOrdersCount,
      },
      topProducts,
      salesOverTime: last7Days,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET inventory status
router.get("/inventory", async (req, res) => {
  try {
    // Get products with inventory information
    const productInventory = await Product.find().select(
      "code name oldStock newStock imported exported costPrice salePrice"
    );

    // Calculate additional metrics
    const inventorySummary = productInventory.map((product) => ({
      productCode: product.code,
      productName: product.name,
      oldStock: product.oldStock,
      imported: product.imported,
      exported: product.exported,
      currentStock: product.newStock,
      stockValue: product.newStock * product.costPrice,
      potentialSaleValue: product.newStock * product.salePrice,
    }));

    // Get list of products with low stock (less than 10 units)
    const lowStockProducts = inventorySummary.filter(
      (item) => item.currentStock < 10
    );

    res.json({
      inventorySummary,
      lowStockProducts,
      totalProductsInStock: inventorySummary.filter(
        (item) => item.currentStock > 0
      ).length,
      totalOutOfStock: inventorySummary.filter((item) => item.currentStock <= 0)
        .length,
      totalStockValue: inventorySummary.reduce(
        (sum, item) => sum + item.stockValue,
        0
      ),
      totalPotentialSaleValue: inventorySummary.reduce(
        (sum, item) => sum + item.potentialSaleValue,
        0
      ),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET customer insights
router.get("/customers", async (req, res) => {
  try {
    // Top customers by order value
    const topCustomers = await Order.aggregate([
      {
        $group: {
          _id: "$customerId",
          totalSpent: { $sum: "$total" },
          orderCount: { $sum: 1 },
        },
      },
      { $sort: { totalSpent: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "customers",
          localField: "_id",
          foreignField: "_id",
          as: "customerInfo",
        },
      },
      { $unwind: "$customerInfo" },
      {
        $project: {
          _id: 1,
          name: "$customerInfo.name",
          totalSpent: 1,
          orderCount: 1,
          averageOrderValue: { $divide: ["$totalSpent", "$orderCount"] },
        },
      },
    ]);

    // New customers in last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const newCustomers = await Customer.countDocuments({
      createdAt: { $gte: thirtyDaysAgo },
    });

    // Customers with debt (dựa trên Order isPaid: false)
    const customersWithDebt = await Order.aggregate([
      { $match: { isPaid: false } },
      {
        $group: {
          _id: "$customerId",
          totalDebt: { $sum: "$total" },
        },
      },
      { $sort: { totalDebt: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "customers",
          localField: "_id",
          foreignField: "_id",
          as: "customerInfo",
        },
      },
      { $unwind: "$customerInfo" },
      {
        $project: {
          _id: 1,
          name: "$customerInfo.name",
          phone: "$customerInfo.phone",
          totalDebt: 1,
        },
      },
    ]);

    // Tổng khách hàng
    const totalCustomers = await Customer.countDocuments();

    // Trả kết quả
    res.json({
      topCustomers,
      newCustomers,
      customersWithDebt,
      totalCustomers,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
