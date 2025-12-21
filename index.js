const express = require("express");
const app = express();
const port = process.env.port || 3000;
const cors = require("cors");
require("dotenv").config();

// firebase
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//stripe
const stripe = require("stripe")(process.env.STRIP_API_KEY);

//mongodb
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_UserName}:${process.env.DB_Password}@cluster0.wkvhhbf.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

//middleware

// Pick the json data from client
app.use(express.json());

app.use(cors());

//main code
async function run() {
  try {
    //Server checking
    app.get("/", (req, res) => {
      res.send("Mokshed");
    });

    //create a DB
    const myDB = client.db("Mokshed");
    //create a collection
    const issuesColl = myDB.collection("issues");
    const usersColl = myDB.collection("users");
    const paymentsColl = myDB.collection("payments");

    //CRUD

    // id = 1
    app.post("/issues", async (req, res) => {
      const New = req.body;
      const result = await issuesColl.insertOne(New);
      res.send(result);
    });

    // id = 2
    app.get("/issues", async (req, res) => {
      const query = {};

      const { firebaseId, id, staffUid, sort, search } = req.query;

      if (firebaseId) {
        query.reporterFirebaseUid = firebaseId;
      }

      if (id) {
        query._id = new ObjectId(id);
      }

      if (staffUid) {
        query.assignedStaffUid = staffUid;
      }

      if (search) {
        console.log("serach");
        console.log(search);
        query.$or = [
          { title: { $regex: search, $options: "i" } },
          { location: { $regex: search, $options: "i" } },
          { category: { $regex: search, $options: "i" } },
        ];
      }

      let sortOptions = { createdAt: -1 };

      if (sort === "boost") {
        query.boosted = true;
        sortOptions = { boostedAt: -1 };
      } else if (sort === "date") {
        sortOptions = { createdAt: -1 };
      } else if (sort === "pending") {
        query.status = "pending";
      } else if (sort === "in-progress") {
        query.status = "in-progress";
      } else if (sort === "working") {
        query.status = "working";
      } else if (sort === "resolved") {
        query.status = "resolved";
      } else if (sort === "closed") {
        query.status = "closed";
      }

      const cursor = issuesColl.find(query).sort(sortOptions);
      const result = await cursor.toArray();

      if (result.length === 0) {
        if (sort === "boost") {
          return res.send({ message: "no data on boost" });
        } else if (sort === "pending") {
          return res.send({ message: "no data on pending" });
        } else if (sort === "in-progress") {
          return res.send({ message: "no data on in-progress" });
        } else if (sort === "working") {
          return res.send({ message: "no data on working" });
        } else if (sort === "resolved") {
          return res.send({ message: "no data on resolved" });
        } else if (sort === "closed") {
          return res.send({ message: "no data on closed" });
        }
      }

      res.send(result);
    });

    // id = 3
    app.get("/user", async (req, res) => {
      const query = {};
      const email = req.query.email;
      if (email) {
        query.email = email;
        const result = await usersColl.findOne(query);
        return res.send({ message: "user data get", result: result });
      }
      const cursor = usersColl.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // id = 4
    app.post("/user", async (req, res) => {
      const New = req.body;
      const userFirebaseUid = { firebaseUid: New.firebaseUid };
      const chackUserIsExit = await usersColl.findOne(userFirebaseUid);
      if (chackUserIsExit) {
        return res.send({ message: "user Already exiet" });
      }
      const result = await usersColl.insertOne(New);
      res.send(result);
    });

    // id = 5
    app.delete("/issues/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await issuesColl.deleteOne(query);
      res.send(result);
    });

    // id = 6
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: paymentInfo.amount,
              product_data: {
                name: paymentInfo.name,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.email,
        mode: "payment",
        metadata: {
          issuesId: paymentInfo.id,
          firebaseUid: paymentInfo.uid,
          type: paymentInfo.type,
        },
        success_url: `${process.env.WEBSITE_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.WEBSITE_URL}/payment/failed`,
      });

      res.send({ url: session.url });
    });

    // id = 7
    app.patch("/payment/success", async (req, res) => {
      const session = await stripe.checkout.sessions.retrieve(
        req.query.session_id
      );

      if (session.payment_status === "paid") {
        const transactionId = { transactionId: session.payment_intent };
        const result3 = await paymentsColl.findOne(transactionId);
        if (result3) {
          return res.send({
            message: "data already axiest",
            transactionId: session.payment_intent,
          });
        }
        //ai
        const type = session.metadata.type;

        if (type === `user subscription`) {
          console.log("i am in");
          const email = session.customer_details.email;
          const query = { email: email };
          const update = {
            $set: {
              isPremium: true,
            },
          };
          const option = {};
          const result = await usersColl.updateOne(query, update, option);

          const paymentData = {
            firebaseUid: session.metadata.firebaseUid,
            amount: session.amount_total,
            type: session.metadata.type,
            provider: "stripe",
            transactionId: session.payment_intent,
            createdAt: new Date(),
          };
          const result2 = await paymentsColl.insertOne(paymentData);
          return res.send({
            issuesCollectionModefid: result,
            paymentData: result2,
            transactionId: session.payment_intent,
          });
        } else {
          const id = session.metadata.issuesId;
          const query = { _id: new ObjectId(id) };
          const update = {
            $set: {
              boosted: "true",
              boostedAt: new Date(),
              priority: "high",
            },
          };
          const option = {};
          const result = await issuesColl.updateOne(query, update, option);

          const paymentData = {
            firebaseUid: session.metadata.firebaseUid,
            amount: session.amount_total,
            type: session.metadata.type,
            issueId: session.metadata.issuesId,
            provider: "stripe",
            transactionId: session.payment_intent,
            createdAt: new Date(),
          };
          const result2 = await paymentsColl.insertOne(paymentData);
          return res.send({
            issuesCollectionModefid: result,
            paymentData: result2,
            transactionId: session.payment_intent,
          });
        }
      }

      res.send({ success: "Data is not updated" });
    });

    // id = 8
    app.get("/payment", async (req, res) => {
      let query = {};
      const uid = req.query.firebaseUid;
      if (uid) {
        query = { firebaseUid: uid };
      }
      const cursor = paymentsColl.find(query);
      const all = await cursor.toArray();
      res.send(all);
    });

    // id = 9
    app.patch("/issues", async (req, res) => {
      const issueId = req.query._id;
      const query = { _id: new ObjectId(issueId) };
      const body = req.body;
      let update = {};

      if (body.title && body.location && body.category && body.description) {
        update = {
          $set: {
            title: body.title,
            location: body.location,
            category: body.category,
            description: body.description,
          },
        };
      }

      if (body.firebaseUid) {
        update = {
          $addToSet: {
            upvoters: body.firebaseUid,
          },
        };
      }

      if (body.StafFirebaseUid && body.StaffName) {
        update = {
          $set: {
            assignedStaffUid: body.StafFirebaseUid,
            assignedStaffName: body.StaffName,
          },
          $addToSet: {
            timeline: {
              status: "pending",
              note: "Issue Assigned With Staff",
              by: `Admin`,
              at: new Date(),
            },
          },
        };
      }

      if (body.StafFirebaseUid === null) {
        update = {
          $set: {
            assignedStaffUid: null,
            assignedStaffName: null,
          },
          $addToSet: {
            timeline: {
              status: "Rejected",
              note: "Issue Rejaected For This Staff",
              by: `Admin`,
              at: new Date(),
            },
          },
        };
      }

      if (body.IssuesStatus === "in-progress") {
        update = {
          $set: {
            status: "in-progress",
          },
          $addToSet: {
            timeline: {
              status: "in-progress",
              note: "Issue is progress stage",
              by: `Staff`,
              at: new Date(),
            },
          },
        };
      }

      if (body.IssuesStatus === "working") {
        update = {
          $set: {
            status: "working",
          },
          $addToSet: {
            timeline: {
              status: "working",
              note: "Issue is working stage",
              by: `Staff`,
              at: new Date(),
            },
          },
        };
      }

      if (body.IssuesStatus === "resolved") {
        update = {
          $set: {
            status: "resolved",
          },
          $addToSet: {
            timeline: {
              status: "resolved",
              note: "Issue is resolved",
              by: `Staff`,
              at: new Date(),
            },
          },
        };
      }

      if (body.IssuesStatus === "closed") {
        update = {
          $set: {
            status: "closed",
          },
          $addToSet: {
            timeline: {
              status: "closed",
              note: "Issue is closed",
              by: `Staff`,
              at: new Date(),
            },
          },
        };
      }

      const option = {};
      const result = await issuesColl.updateOne(query, update, option);
      res.send(result);
    });

    // id = 10
    app.patch("/user", async (req, res) => {
      const id = req.query.id;
      const Uid = req.query.Uid;
      const UpdateStaffId = req.query.UpdateStaffId;

      if (id) {
        const query = { _id: new ObjectId(id) };
        const body = req.body;
        const update = {
          $set: {
            isBlocked: body.data,
          },
        };
        const option = {};
        const result = await usersColl.updateOne(query, update, option);
        return res.send(result);
      }

      if (Uid) {
        const query = { firebaseUid: Uid };
        const body = req.body;
        const update = {
          $set: {
            name: body.name,
            photoURL: body.photoURL,
            updateAt: new Date(),
          },
        };
        const option = {};
        const result = await usersColl.updateOne(query, update, option);
        return res.send(result);
      }

      if (UpdateStaffId) {
        const query = { _id: new ObjectId(UpdateStaffId) };
        const body = req.body;
        const update = {
          $set: {
            name: body.name,
            photoURL: body.imgURL,
          },
        };
        const option = {};
        const result = await usersColl.updateOne(query, update, option);
        return res.send(result);
      }

      res.send({ message: "not updated" });
    });

    // id = 11
    app.post("/create/staff", async (req, res) => {
      const rawEmail = req.body.email;
      const email = rawEmail.toLowerCase();

      const {
        name,
        password,
        photoURL,
        role,
        phone,
        isBlocked,
        isPremium,
        createdAt,
      } = req.body;
      const user = await admin.auth().createUser({
        email,
        password,
        displayName: name,
        photoURL: photoURL,
        phoneNumber: `+88${phone}`,
      });
      const userFirebaseUid = { firebaseUid: user.uid };
      const chackUserIsExit = await usersColl.findOne(userFirebaseUid);
      if (chackUserIsExit) {
        return res.send({ message: "user Already exiet" });
      }
      const result = await usersColl.insertOne({
        firebaseUid: user.uid,
        email,
        password,
        role,
        phone,
        isBlocked,
        createdAt,
        isPremium,
        photoURL,
        name,
      });
      res.send(result);
    });

    // id = 12
    app.delete("/staff_delete/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersColl.deleteOne(query);
      res.send(result);
    });

    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    //await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
