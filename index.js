require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const SHA256 = require("crypto-js/sha256");
const encBase64 = require("crypto-js/enc-base64");
const uid2 = require("uid2");
// const { appendFile } = require("fs");
const fileUpload = require("express-fileupload");
const cloudinary = require("cloudinary").v2;
const createStripe = require("stripe");

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

const convertToBase64 = (file) => {
  return `data:${file.mimetype};base64,${file.data.toString("base64")}`;
};
const app = express();
app.use(express.json());
app.use(cors());

mongoose.connect(process.env.MONGODB_URL);

//modèles

const User = mongoose.model("User", {
  email: String,
  account: {
    username: String,
    avatar: Object,
  },
  newsletter: Boolean,
  token: String,
  hash: String,
  salt: String,
});

const Offer = mongoose.model("Offer", {
  product_name: String,
  product_description: String,
  product_price: Number,
  product_details: Array,
  product_image: Object,
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
});

//Création d'un nouveau User

app.post("/user/signup", async (req, res) => {
  try {
    if (req.body.username === undefined) {
      res.status(400).json({ message: "Missing parameters" });
    } else {
      const isEmailAlreadyinDB = await User.findOne({ email: req.body.email });
      if (isEmailAlreadyinDB !== null) {
        res.json({ message: "This email already has an account" });
      } else {
        const salt = uid2(16);
        const hash = SHA256(req.body.password + salt).toString(encBase64);
        const token = uid2(32);

        const newUser = new User({
          email: req.body.email,
          account: {
            username: req.body.username,
            // avatar: req.body.avatar,
          },
          newsletter: req.body.newsletter,
          token: token,
          hash: hash,
          salt: salt,
        });
        await newUser.save();
        res.json({
          _id: newUser._id,
          email: newUser.email,
          token: newUser.token,
          account: newUser.account,
        });
      }
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

//Login d'un User
app.post("/user/login", async (req, res) => {
  try {
    const userToCheck = await User.findOne({ email: req.body.email });
    if (userToCheck === null) {
      res.status(401).json({ message: "Unauthorized 1" });
    } else {
      const newHash = SHA256(req.body.password + userToCheck.salt).toString(
        encBase64
      );
      if (newHash === userToCheck.hash) {
        res.json({
          _id: userToCheck._id,
          token: userToCheck.token,
          account: userToCheck.account,
        });
      } else {
        res.status(400).json({ message: "Unauthorized 2" });
      }
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Poster une annonce

const isAuthenticated = async (req, res, next) => {
  if (req.headers.authorization) {
    const user = await User.findOne({
      token: req.headers.authorization.replace("Bearer ", ""),
    });

    if (user) {
      req.user = user;
      next();
    } else {
      res.status(401).json({ error: "Token présent mais non valide !" });
    }
  } else {
    res.status(401).json({ error: "Token non envoyé !" });
  }
};

app.post("/offer/publish", isAuthenticated, fileUpload(), async (req, res) => {
  try {
    const newOffer = new Offer({
      product_name: req.body.title,
      product_description: req.body.description,
      product_price: req.body.price,
      product_details: [
        { MARQUE: req.body.brand },
        { TAILLE: req.body.size },
        { ETAT: req.body.condition },
        { COULEUR: req.body.color },
        { EMPLACEMENT: req.body.city },
      ],
      owner: req.user,
    });

    const result = await cloudinary.uploader.upload(
      convertToBase64(req.files.picture),
      {
        folder: "vinted/offers",
        public_id: `${req.body.title} - ${newOffer._id}`,
      }
    );

    newOffer.product_image = result;

    await newOffer.save();

    res.json(newOffer);
    alert("Offre publiée avec succès!");
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Afficher les annonces

app.get("/offers", async (req, res) => {
  try {
    const offers = await Offer.find();
    res.status(200).json(offers);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Route pour afficher une annonce en fonction de son id

app.get("/offer/:id", async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id).populate({
      path: "owner",
      select: "account.username account.phone account.avatar",
    });
    res.json(offer);
  } catch (error) {
    console.log(error.message);
    res.status(400).json({ message: error.message });
  }
});

// app.get("/offers", async (req, res) => {
//   try {
//     let offers;
//     //   product_name: new RegExp(req.query.title, "i"),
//     //   product_price: { $gte: req.query.priceMin, $lte: req.query.priceMax },
//     if (req.query.title) {
//       (offers = await Offer.find({
//         product_name: new RegExp(req.query.title, "i"),
//       })
//         .sort({ product_price: "ascending" })
//         .select("product_name product_price -_id")),
//         res.json(offers);
//     } else if (req.query.title && req.query.priceMin) {
//       (offers = await Offer.find({
//         product_name: new RegExp(req.query.title, "i"),
//         product_price: req.query.price,
//       })
//         .sort({ product_price: "ascending" })
//         .select("product_name product_price -_id")),
//         console.log(offers);
//       res.json(offers);
//     } else {
//       res.status(400).json({ message: "Recherche inexistante" });
//     }
//   } catch (error) {
//     res.status(400).json({ message: error.message });
//   }
// });

// Route payment

const stripe = createStripe(process.env.STRIPE_API_SECRET);

app.post("/payment", isAuthenticated, async (req, res) => {
  console.log(req.body);
  try {
    const stripeToken = req.body.stripeToken;
    let { status } = await stripe.charges.create({
      amount: (req.body.amount * 100).toFixed(0),
      currency: "eur",
      description: `Paiement vinted pour : ${req.body.title}`,
      source: stripeToken,
      owner: req.user,
    });
    res.status(200).json({ status });
    console.log({ status });
  } catch (error) {
    console.log(error.message);
    res.status(400).json({ error: error.message });
  }
});

app.listen(process.env.PORT, () => {
  console.log("Server has started");
});
