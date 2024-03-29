require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const SHA256 = require("crypto-js/sha256");
const encBase64 = require("crypto-js/enc-base64");
const uid2 = require("uid2");
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
  product_date: { type: Date, default: Date.now },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
});

//Création d'un nouveau User

app.post("/user/signup", fileUpload(), async (req, res) => {
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
          },
          newsletter: req.body.newsletter,
          token: token,
          hash: hash,
          salt: salt,
        });

        const resultImage = await cloudinary.uploader.upload(
          convertToBase64(req.files.avatar, {
            folder: `vinted/users/${newUser._id}`,
            public_id: "avatar",
          })
        );
        newUser.account.avatar = resultImage;

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
      convertToBase64(req.files.picture, {
        folder: "vinted/offers",
        public_id: `${req.body.title} - ${newOffer._id}`,
      })
    );

    newOffer.product_image = result;

    await newOffer.save();
    res.json(newOffer);
  } catch (error) {
    res.status(400).json("route catch");
  }
});

// Route supprimer une offre

app.delete("/offer/delete/:id", async (req, res) => {
  try {
    if (req.params.id) {
      await cloudinary.uploader.destroy(`vinted/offers/${req.params.id}`);
      await Offer.findByIdAndDelete(req.params.id);

      res.status(200).json("Offer deleted");
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Afficher les annonces

app.get("/offers", async (req, res) => {
  try {
    let filters = {};

    if (req.query.search) {
      filters.product_name = new RegExp(req.query.search, "i");
    }
    const offers = await Offer.find(filters).populate({
      path: "owner",
      select: "account.username account.avatar",
    });

    res.json(offers);
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
    res.status(400).json({ message: error.message });
  }
});

// Route payment

const stripe = createStripe(process.env.STRIPE_API_SECRET);

app.post("/payment", async (req, res) => {
  try {
    const stripeToken = req.body.stripeToken;
    let { status } = await stripe.charges.create({
      amount: (req.body.amount * 100).toFixed(0),
      currency: "eur",
      description: `Paiement vinted pour : ${req.body.title}`,
      source: stripeToken,
      user: req.user,
    });
    res.status(200).json({ status });
  } catch (error) {
    console.log(error.message);
    res.status(400).json({ error: error.message });
  }
});

app.listen(process.env.PORT, () => {
  console.log("Server has started !");
});
