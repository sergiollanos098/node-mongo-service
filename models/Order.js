const mongoose = require("mongoose");

const OrderSchema = new mongoose.Schema({
  product: String,
  price: Number,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
});

module.exports = mongoose.model("Order", OrderSchema);
