const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/auth');
const auth = require('../middleware/auth');

// Đăng nhập
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu!' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu!' });
    }
    // Tạo JWT token
    const token = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET || 'secret_key',
      { expiresIn: '1d' }
    );
    res.json({ token, user: { id: user._id, username: user.username } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Đăng ký tài khoản mới
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Thiếu username hoặc password' });
    }
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Tài khoản đã tồn tại' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword });
    await user.save();
    res.status(201).json({ message: 'Đăng ký thành công' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Middleware bảo vệ tất cả các route phía dưới
router.use(auth);

// Lấy danh sách user (chỉ cho phép user đã đăng nhập)
router.get('/list', async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Đăng xuất (logout)
router.post('/logout', (req, res) => {
  // Để logout với JWT, FE chỉ cần xoá token ở localStorage/cookie
  // BE chỉ trả về thông báo thành công
  res.json({ message: 'Đăng xuất thành công. Vui lòng xoá token ở phía client.' });
});

module.exports = router;
