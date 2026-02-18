const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const API_KEY = process.env.OPENSTATES_API_KEY;

app.post("/lookup", async (req, res) => {
  try {
    const address = req.body.address;

    const geo = await axios.get(
      "https://nominatim.openstreetmap.org/search",
      {
        params: {
          q: address + ", Maine",
          format: "json",
          limit: 1
        }
      }
    );

    if (!geo.data.length) {
      return res.status(404).send("Address not found");
    }

    const lat = geo.data[0].lat;
    const lon = geo.data[0].lon;

    const legislators = await axios.get(
      "https://v3.openstates.org/people.geo",
      {
        params: {
          lat: lat,
          lng: lon,
          apikey: API_KEY
        }
      }
    );

    res.json(legislators.data.results);

  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
