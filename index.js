// backend/index.js

const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer-core"); // Use puppeteer-core instead of puppeteer
const axios = require("axios"); // Import Axios for making HTTP requests
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Function to resolve Google Maps short link to place name and coordinates
async function resolveLink(url) {
  try {
    console.log(`Resolving link: ${url}`);

    // Launch Puppeteer with the correct executable path for Chrome
    const browser = await puppeteer.launch({
      executablePath:
        process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser", // Default path for Chromium
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.goto(url);
    const finalUrl = await page.url(); // Get final URL after redirect

    await browser.close();

    // Extract latitude and longitude from the final URL
    const latLngMatch = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (!latLngMatch) {
      console.warn(`Could not extract latitude and longitude from ${finalUrl}`);
      return null; // Return null if extraction fails
    }

    const latitude = parseFloat(latLngMatch[1]);
    const longitude = parseFloat(latLngMatch[2]);

    // Extract place name from the final URL
    const placeMatch = finalUrl.match(/place\/([^/?]+)/);
    if (!placeMatch) {
      console.warn(`Could not extract place name from ${finalUrl}`);
      return null; // Return null if extraction fails
    }

    const placeName = decodeURIComponent(placeMatch[1].replace(/\+/g, " "));

    console.log(
      `Resolved link: ${url} -> ${placeName} (Lat: ${latitude}, Lng: ${longitude})`
    );
    return { name: placeName, coords: { lat: latitude, lng: longitude } }; // Return object with name and coords
  } catch (error) {
    console.error(`Error resolving link ${url}:`, error.message);
    return null; // Return null on error
  }
}

// Function to get distances between all pairs of locations using Google Distance Matrix API
async function getDistanceMatrix(locations) {
  const origins = locations.map((location) => location.name).join("|");
  const destinations = origins; // For a complete matrix, use the same locations as destinations

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(
    origins
  )}&destinations=${encodeURIComponent(destinations)}&key=${
    process.env.GOOGLE_MAPS_API_KEY
  }`;

  try {
    console.log(`Fetching distance matrix from API...`);
    const response = await axios.get(url);

    if (response.data.status !== "OK") {
      throw new Error(
        `Error fetching distance matrix: ${response.data.status}`
      );
    }

    console.log("Distance matrix fetched successfully.");

    // Create a distance matrix based on the response
    const distanceMatrix = response.data.rows.map((row) =>
      row.elements.map((element) => ({
        distance: element.distance.value,
        duration: element.duration.value,
        status: element.status,
      }))
    );

    return distanceMatrix;
  } catch (error) {
    console.error(`Error fetching distance matrix:`, error.message);
    throw error;
  }
}

// Brute-force TSP algorithm that works with location objects and their distances
function tspBruteForce(locations, distanceMatrix) {
  const n = locations.length;
  const visited = Array(n).fill(false);
  let minDistance = Infinity;
  let bestRoute = [];

  function backtrack(currentIndex, count, currentDistance, path) {
    if (count === n) {
      let totalDistance =
        currentDistance + distanceMatrix[path[n - 1]][path[0]].distance; // Return to starting point

      // Update minDistance and bestRoute if the current path is shorter
      if (totalDistance < minDistance) {
        minDistance = totalDistance;
        bestRoute = path.slice();
      }
      return;
    }

    for (let i = 0; i < n; i++) {
      if (!visited[i]) {
        visited[i] = true;
        path.push(i);
        currentDistance +=
          count === 0 ? 0 : distanceMatrix[currentIndex][i].distance; // Add distance only after first node
        backtrack(i, count + 1, currentDistance, path);
        visited[i] = false;
        path.pop();
        currentDistance -=
          count === 0 ? 0 : distanceMatrix[currentIndex][i].distance; // Backtrack distance
      }
    }
  }

  console.log("Starting TSP algorithm...");
  backtrack(-1, 0, 0, []);
  console.log("TSP algorithm completed.");
  console.log(
    "Optimized route:",
    bestRoute.map((index) => locations[index].name)
  );
  return bestRoute.map((index) => locations[index].name);
}

app.post("/optimize_route", async (req, res) => {
  const locations = req.body.locations;

  try {
    console.log("Received locations:", locations);

    const locationDataPromises = locations.map(async (url) => {
      // Resolve Google Maps link to place name and coordinates
      return await resolveLink(url);
    });

    // Wait for all promises to resolve
    const locationData = await Promise.all(locationDataPromises);

    console.log("Resolved location data:", locationData);

    // Filter out any null values before calculating distances
    const validLocations = locationData.filter((item) => item !== null);

    if (validLocations.length < 2) {
      throw new Error(
        "At least two valid locations are required for optimization."
      );
    }

    // Get distances between all valid locations
    const distanceMatrix = await getDistanceMatrix(validLocations);

    // Calculate optimized route using the distance matrix
    const optimizedRoute = tspBruteForce(validLocations, distanceMatrix);

    res.json({ optimized_route: optimizedRoute }); // Return only the keys of the optimized order
  } catch (error) {
    console.error("Error in /optimize_route:", error.message); // Log detailed error
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
