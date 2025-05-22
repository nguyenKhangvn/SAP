const express = require("express");
const router = express.Router();
const StockMovement = require("../models/StockMovement");
const Product = require("../models/Product");
const auth = require('../middleware/auth');

// Bảo vệ tất cả các route tồn kho bằng JWT
router.use(auth);

// API: GET tồn kho hiện tại
router.get("/", async (req, res) => {
  try {
    const stocks = await StockMovement.aggregate([
      {
        $group: {
          _id: "$productCode",
          totalImport: {
            $sum: {
              $cond: [{ $eq: ["$type", "import"] }, "$quantity", 0]
            }
          },
          totalExport: {
            $sum: {
              $cond: [{ $eq: ["$type", "export"] }, "$quantity", 0]
            }
          }
        }
      },
      {
        $project: {
          productCode: "$_id",
          _id: 0,
          totalImport: 1,
          totalExport: 1,
          stock: { $subtract: ["$totalImport", "$totalExport"] }
        }
      }
    ]);

    res.json(stocks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//tồn khoa theo ngày/tháng
router.get("/", async (req, res) => {
  try {
    const from = new Date(req.query.from || "2000-01-01");
    const to = new Date(req.query.to || "2100-01-01");

    const stockData = await StockMovement.aggregate([
      {
        $match: {
          date: { $gte: from, $lte: to }
        }
      },
      {
        $group: {
          _id: "$productCode",
          totalImport: {
            $sum: {
              $cond: [{ $eq: ["$type", "import"] }, "$quantity", 0]
            }
          },
          totalExport: {
            $sum: {
              $cond: [{ $eq: ["$type", "export"] }, "$quantity", 0]
            }
          }
        }
      },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "code",
          as: "productInfo"
        }
      },
      {
        $unwind: "$productInfo"
      },
      {
        $project: {
          productCode: "$_id",
          _id: 0,
          productName: "$productInfo.name",
          totalImport: 1,
          totalExport: 1,
          stock: { $subtract: ["$totalImport", "$totalExport"] }
        }
      }
    ]);

    res.json(stockData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cập nhật số liệu tồn kho cho sản phẩm
router.post("/update-stats", async (req, res) => {
  try {
    const { productCode, type, quantity, notes } = req.body;
    
    if (!productCode || !type || !quantity) {
      return res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
    }
    
    // Tìm sản phẩm theo mã
    const product = await Product.findOne({ code: productCode });
    if (!product) {
      return res.status(404).json({ error: "Không tìm thấy sản phẩm" });
    }
    
    // Lưu trữ tồn cũ trước khi cập nhật
    product.oldStock = product.newStock;
    
    // Cập nhật dữ liệu dựa trên loại giao dịch
    if (type === "import") {
      product.imported += quantity;
      product.newStock += quantity;
    } else if (type === "export") {
      product.exported += quantity;
      product.newStock -= quantity;
    } else {
      return res.status(400).json({ error: "Loại giao dịch không hợp lệ" });
    }
    
    // Lưu thông tin vào stock movement
    const stockMovement = new StockMovement({
      date: new Date(),
      productCode,
      type,
      quantity,
      note: notes || ""
    });
    
    await stockMovement.save();
    await product.save();
    
    res.status(201).json({
      message: "Đã cập nhật tồn kho thành công",
      currentStock: product.newStock
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Xem lịch sử xuất nhập kho theo mã sản phẩm
router.get("/history/:productCode", async (req, res) => {
  try {
    const { productCode } = req.params;
    const movements = await StockMovement.find({ productCode })
      .sort({ date: -1 });
    
    res.json(movements);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Báo cáo tồn kho hiện tại với thông tin chi tiết sản phẩm
router.get("/report", async (req, res) => {
  try {
    const products = await Product.find().select('code name costPrice salePrice oldStock newStock imported exported');
    
    // Tính toán giá trị tồn kho
    let totalCostValue = 0;
    let totalSaleValue = 0;
    
    const report = products.map(product => {
      const costValue = product.newStock * (product.costPrice || 0);
      const saleValue = product.newStock * (product.salePrice || 0);
      
      totalCostValue += costValue;
      totalSaleValue += saleValue;
      
      return {
        code: product.code,
        name: product.name,
        oldStock: product.oldStock || 0,
        imported: product.imported || 0,
        exported: product.exported || 0,
        newStock: product.newStock || 0,
        costPrice: product.costPrice || 0,
        salePrice: product.salePrice || 0,
        costValue: costValue,
        saleValue: saleValue,
        potential_profit: saleValue - costValue
      };
    });
    
    // Phân loại sản phẩm theo tồn kho
    const lowStock = report.filter(p => p.newStock > 0 && p.newStock < 10);
    const outOfStock = report.filter(p => p.newStock <= 0);
    const inStock = report.filter(p => p.newStock >= 10);
    
    res.json({
      items: report,
      summary: {
        totalProducts: products.length,
        totalCostValue,
        totalSaleValue,
        totalPotentialProfit: totalSaleValue - totalCostValue,
        lowStockCount: lowStock.length,
        outOfStockCount: outOfStock.length,
        inStockCount: inStock.length
      },
      lowStock,
      outOfStock
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
