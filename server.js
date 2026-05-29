require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("ShopVerse backend running");
});

app.post("/api/signup", async (req, res) => {
  const { name, fullName, email, password } = req.body;
  const customerName = name || fullName;

  if (!customerName || !email || !password) {
    return res.status(400).json({
      success: false,
      message: "Name, email and password are required",
    });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const sql = `
      INSERT INTO customers
      (name, email, password)
      VALUES (?, ?, ?)
    `;

    db.query(sql, [customerName, email, hashedPassword], (err, result) => {
      if (err) {
        if (err.code === "ER_DUP_ENTRY") {
          return res.status(409).json({
            success: false,
            message: "Email already exists",
          });
        }

        return res.status(500).json({
          success: false,
          message: "Signup failed",
          error: err.message,
        });
      }

      res.status(201).json({
        success: true,
        message: "Customer created successfully",
        customer_id: result.insertId,
      });
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Signup failed",
      error: error.message,
    });
  }
});

app.post("/api/signin", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      message: "Email and password are required",
    });
  }

  const sql = "SELECT * FROM customers WHERE email = ?";

  db.query(sql, [email], async (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Signin failed",
        error: err.message,
      });
    }

    if (results.length === 0) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const customer = results[0];
    const isPasswordMatch = await bcrypt.compare(password, customer.password);

    if (!isPasswordMatch) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const token = jwt.sign(
      { customerId: customer.customer_id },
      process.env.JWT_SECRET || "shopverse_secret_key",
      { expiresIn: "1d" }
    );

    const customerName = customer.name || customer.full_name;

    res.json({
      message: "Signin successful",
      token,
      customer: {
        customerId: customer.customer_id,
        name: customerName,
        fullName: customerName,
        email: customer.email,
      },
    });
  });
});

app.post("/api/checkout", (req, res) => {
  const { customerId, cartItems } = req.body;

  if (!customerId || !Array.isArray(cartItems) || cartItems.length === 0) {
    return res.status(400).json({
      message: "Customer ID and cart items are required",
    });
  }

  const normalizedCartItems = cartItems.map((item) => {
    const id = Number(item.id ?? item.productId);
    const name = item.name ?? item.productName;
    const price = Number(item.price);
    const quantity = Number(item.quantity);

    return {
      id,
      name,
      price,
      quantity,
    };
  });

  const hasInvalidCartItem = normalizedCartItems.some((item) => {
    return (
      !Number.isInteger(item.id) ||
      item.id <= 0 ||
      !item.name ||
      !Number.isFinite(item.price) ||
      item.price < 0 ||
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0
    );
  });

  if (hasInvalidCartItem) {
    return res.status(400).json({
      message:
        "Each cart item must include a valid id, name, numeric price and numeric quantity",
    });
  }

  const netAmount = normalizedCartItems.reduce((sum, item) => {
    return sum + item.price * item.quantity;
  }, 0);

  const totalAmount = netAmount;

  const orderSql = `
    INSERT INTO orders
    (customer_id, net_amount, total_amount)
    VALUES (?, ?, ?)
  `;

  db.beginTransaction((transactionErr) => {
    if (transactionErr) {
      return res.status(500).json({
        message: "Checkout failed",
        error: transactionErr.message,
      });
    }

    db.query(
      orderSql,
      [customerId, netAmount, totalAmount],
      (err, orderResult) => {
        if (err) {
          return db.rollback(() => {
            res.status(500).json({
              message: "Order creation failed",
              error: err.message,
            });
          });
        }

        const orderId = orderResult.insertId;
        const orderItemsData = normalizedCartItems.map((item) => [
          orderId,
          item.id,
          item.name,
          item.quantity,
          item.price,
          item.price * item.quantity,
        ]);

        const itemSql = `
          INSERT INTO order_items
          (order_id, product_id, product_name, quantity, price, item_total)
          VALUES ?
        `;

        db.query(itemSql, [orderItemsData], (err2) => {
          if (err2) {
            console.error("Order items insert failed:", err2);

            return db.rollback(() => {
              res.status(500).json({
                message: "Order items insert failed",
                error: err2.message,
              });
            });
          }

          db.commit((commitErr) => {
            if (commitErr) {
              return db.rollback(() => {
                res.status(500).json({
                  message: "Checkout failed",
                  error: commitErr.message,
                });
              });
            }

            res.status(201).json({
              message: "Order placed successfully",
              orderId,
              customerId,
              netAmount,
              totalAmount,
            });
          });
        });
      }
    );
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
