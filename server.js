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

    const results = legislators.data.results.map(p => {
  const jur = p.jurisdiction?.name || null;
  const role = p.current_role || {};
  const chamber =
    role.org_classification === "upper" ? "Senate" :
    role.org_classification === "lower" ? "House" :
    null;

  const level =
    jur === "United States" ? "Federal" :
    jur === "Maine" ? "State" :
    "Other";

  return {
    name: p.name,
    given_name: p.given_name || null,
    family_name: p.family_name || null,
    party: p.party || null,
    level,
    jurisdiction: jur,
    office: role.title || null,              // Senator / Representative
    chamber,                                  // Senate / House (when applicable)
    district: role.district || null,          // e.g. "28" or "ME-1" or "Maine"
    division_id: role.division_id || null,
    email: p.email || null,                   // sometimes a form URL, sometimes an email
    image: p.image || null,
    openstates_url: p.openstates_url || null
  };
});

return res.json({
  input: address,
  geocode: { lat, lon },
  officials: results
});
;

  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
