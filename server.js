const express = require("express");
const axios = require("axios");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();

app.use(cors());
app.use(express.json());

const API_KEY = process.env.OPENSTATES_API_KEY;
const PORT = process.env.PORT || 3000;

// --------------------
// Rate limiting
// --------------------
// This protects your upstream APIs and your server from bursts.
// Tune as needed. This is a sensible starting point.
const lookupLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 60,             // 60 requests/minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." }
});

// Apply rate limiting only to /lookup
app.use("/lookup", lookupLimiter);

// --------------------
// Simple in-memory caches
// --------------------
// NOTE: These reset when Render restarts/redeploys.
const geoCache = new Map();      // key: normalized address -> { lat, lon, ts }
const resultCache = new Map();   // key: "lat,lon" -> { payload, ts }

// TTLs
const GEO_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days
const RESULT_TTL_MS = 24 * 60 * 60 * 1000;   // 24 hours

function isFresh(entry, ttlMs) {
  return entry && (Date.now() - entry.ts) < ttlMs;
}

// Optional: basic health check
app.get("/", (req, res) => {
  res.json({ ok: true, service: "maine-reps-backend" });
});

app.post("/lookup", async (req, res) => {
  try {
    const address = req.body.address;

    if (!address || typeof address !== "string") {
      return res.status(400).json({ error: "Please provide an address string." });
    }

    if (!API_KEY) {
      return res.status(500).json({ error: "Missing OPENSTATES_API_KEY in environment variables." });
    }

    // --------------------
    // 1) Geocode with caching (address -> lat/lon)
    // --------------------
    const keyAddress = address.trim().toLowerCase();

    let lat, lon;
    const cachedGeo = geoCache.get(keyAddress);

    if (isFresh(cachedGeo, GEO_TTL_MS)) {
      ({ lat, lon } = cachedGeo);
    } else {
      const geo = await axios.get("https://nominatim.openstreetmap.org/search", {
        params: {
          q: address + ", Maine",
          format: "json",
          limit: 1
        },
        headers: {
          "User-Agent": "maine-reps-backend/1.0"
        }
      });

      if (!geo.data.length) {
        return res.status(404).json({ error: "Address not found" });
      }

      lat = geo.data[0].lat;
      lon = geo.data[0].lon;

      geoCache.set(keyAddress, { lat, lon, ts: Date.now() });
    }

    // --------------------
    // 2) Result cache (lat/lon -> final payload)
    // --------------------
    const keyLatLon = `${lat},${lon}`;
    const cachedResult = resultCache.get(keyLatLon);

    if (isFresh(cachedResult, RESULT_TTL_MS)) {
      return res.json(cachedResult.payload);
    }

    // --------------------
    // 3) Fetch legislators (OpenStates)
    // --------------------
    const legislators = await axios.get("https://v3.openstates.org/people.geo", {
      params: {
        lat: lat,
        lng: lon,
        apikey: API_KEY
      }
    });

    // --------------------
    // 4) Format response
    // --------------------
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
        office: role.title || null,
        chamber,
        district: role.district || null,
        division_id: role.division_id || null,
        email: p.email || null,
        image: p.image || null,
        openstates_url: p.openstates_url || null
      };
    });

    const payload = {
      input: address,
      geocode: { lat, lon },
      officials: results
    };

    // Store final payload in cache
    resultCache.set(keyLatLon, { payload, ts: Date.now() });

    return res.json(payload);

  } catch (err) {
    console.error("Lookup error:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Lookup failed",
      details: err.response?.data || err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
