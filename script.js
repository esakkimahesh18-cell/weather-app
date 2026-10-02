// ===== State =====
let unit = "C";          // "C" or "F"
let lastData = null;     // last fetched weather, so unit toggle needs no refetch
let lastPlace = "";

// ===== DOM references =====
const $ = (id) => document.getElementById(id);
const statusEl = $("status");

// ===== Weather code -> label, icon, theme (WMO codes used by Open-Meteo) =====
function describe(code, isDay = 1) {
  if (code === 0)  return { label: isDay ? "Clear sky" : "Clear night", icon: isDay ? "☀️" : "🌙", theme: "sunny" };
  if (code <= 2)   return { label: "Partly cloudy", icon: isDay ? "⛅" : "☁️", theme: "cloudy" };
  if (code === 3)  return { label: "Overcast", icon: "☁️", theme: "cloudy" };
  if (code <= 48)  return { label: "Fog", icon: "🌫️", theme: "cloudy" };
  if (code <= 57)  return { label: "Drizzle", icon: "🌦️", theme: "rainy" };
  if (code <= 67)  return { label: "Rain", icon: "🌧️", theme: "rainy" };
  if (code <= 77)  return { label: "Snow", icon: "❄️", theme: "snowy" };
  if (code <= 82)  return { label: "Rain showers", icon: "🌧️", theme: "rainy" };
  if (code <= 86)  return { label: "Snow showers", icon: "🌨️", theme: "snowy" };
  return { label: "Thunderstorm", icon: "⛈️", theme: "stormy" };
}

// ===== Helpers =====
function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
  statusEl.hidden = false;
}
function hideStatus() { statusEl.hidden = true; }

// API always returns °C; convert here when user picks °F
function formatTemp(c) {
  const value = unit === "C" ? c : (c * 9) / 5 + 32;
  return `${Math.round(value)}°`;
}

// ===== API calls =====
// 1) City name -> latitude/longitude
async function geocode(city) {
  const url = `${CONFIG.GEO_URL}?name=${encodeURIComponent(city)}&count=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("SERVER");
  const data = await res.json();
  if (!data.results || data.results.length === 0) throw new Error("NOT_FOUND");
  const r = data.results[0];
  return { lat: r.latitude, lon: r.longitude, name: `${r.name}, ${r.country || ""}`.replace(/, $/, "") };
}

// 2) Coordinates -> current weather + 5-day forecast
async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,pressure_msl,wind_speed_10m,weather_code,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    forecast_days: 5,
    timezone: "auto",
  });
  const res = await fetch(`${CONFIG.WEATHER_URL}?${params}`);
  if (!res.ok) throw new Error("SERVER");
  return res.json();
}

// ===== Render =====
function render() {
  if (!lastData) return;
  const c = lastData.current;
  const info = describe(c.weather_code, c.is_day);

  $("place").textContent = lastPlace;
  $("icon").textContent = info.icon;
  $("temp").textContent = formatTemp(c.temperature_2m);
  $("condition").textContent = info.label;
  $("feels").textContent = formatTemp(c.apparent_temperature);
  $("humidity").textContent = `${c.relative_humidity_2m}%`;
  $("wind").textContent = `${Math.round(c.wind_speed_10m)} km/h`;
  $("pressure").textContent = `${Math.round(c.pressure_msl)} hPa`;

  // Theme: night overrides everything else
  document.body.dataset.weather = c.is_day ? info.theme : "night";

  // 5-day forecast
  const d = lastData.daily;
  $("forecast").innerHTML = d.time.map((date, i) => {
    const day = i === 0 ? "Today" : new Date(date).toLocaleDateString(undefined, { weekday: "long" });
    const f = describe(d.weather_code[i]);
    return `<li>
      <span class="day">${day}</span>
      <span class="fi" title="${f.label}">${f.icon}</span>
      <span class="range">${formatTemp(d.temperature_2m_max[i])} <span class="lo">${formatTemp(d.temperature_2m_min[i])}</span></span>
    </li>`;
  }).join("");

  $("current").hidden = false;
  $("forecast-wrap").hidden = false;
}

// ===== Main loader with friendly errors =====
async function load(getLocation) {
  showStatus("Loading weather…");
  try {
    const { lat, lon, name } = await getLocation();
    lastData = await fetchWeather(lat, lon);
    lastPlace = name;
    render();
    hideStatus();
  } catch (err) {
    $("current").hidden = true;
    $("forecast-wrap").hidden = true;
    if (err.message === "NOT_FOUND") showStatus("City not found. Check the spelling and try again.", true);
    else if (err.message === "DENIED") showStatus("Location access was denied. Search for a city instead.", true);
    else if (!navigator.onLine || err instanceof TypeError) showStatus("No internet connection. Check your network and try again.", true);
    else showStatus("The weather service is not responding. Try again in a moment.", true);
  }
}

// ===== Event handlers =====
$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const city = $("city-input").value.trim();
  if (!city) return showStatus("Enter a city name to search.", true);
  load(() => geocode(city));
});

$("locate-btn").addEventListener("click", () => {
  if (!navigator.geolocation) return showStatus("Your browser does not support location.", true);
  load(() => new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, name: "Your location" }),
      () => reject(new Error("DENIED"))
    );
  }));
});

$("unit-btn").addEventListener("click", () => {
  unit = unit === "C" ? "F" : "C";
  $("unit-btn").textContent = `°${unit}`;
  render();
});

$("theme-btn").addEventListener("click", () => {
  const next = document.body.dataset.mode === "dark" ? "light" : "dark";
  document.body.dataset.mode = next;
  $("theme-btn").textContent = next === "dark" ? "Light" : "Dark";
  try { localStorage.setItem("mode", next); } catch (_) {}
});

// ===== Startup: restore theme, load a default city =====
(function init() {
  let mode = "light";
  try { mode = localStorage.getItem("mode") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); } catch (_) {}
  document.body.dataset.mode = mode;
  $("theme-btn").textContent = mode === "dark" ? "Light" : "Dark";
  load(() => geocode("Chennai"));
})();
