import socket, ssl, requests
from datetime import datetime, timezone

WEATHER_CODES = {
    0: ("Clear sky", "fa-sun"),
    1: ("Mainly clear", "fa-sun"),
    2: ("Partly cloudy", "fa-cloud-sun"),
    3: ("Overcast", "fa-cloud"),
    45: ("Fog", "fa-smog"),
    48: ("Depositing rime fog", "fa-smog"),
    51: ("Light drizzle", "fa-cloud-rain"),
    53: ("Moderate drizzle", "fa-cloud-rain"),
    55: ("Dense drizzle", "fa-cloud-rain"),
    61: ("Slight rain", "fa-cloud-rain"),
    63: ("Moderate rain", "fa-cloud-showers-heavy"),
    65: ("Heavy rain", "fa-cloud-showers-heavy"),
    71: ("Slight snow", "fa-snowflake"),
    73: ("Moderate snow", "fa-snowflake"),
    75: ("Heavy snow", "fa-snowflake"),
    80: ("Rain showers", "fa-cloud-showers-heavy"),
    81: ("Rain showers", "fa-cloud-showers-heavy"),
    82: ("Violent rain showers", "fa-cloud-showers-heavy"),
    95: ("Thunderstorm", "fa-bolt"),
    96: ("Thunderstorm with hail", "fa-cloud-bolt"),
    99: ("Thunderstorm with hail", "fa-cloud-bolt"),
}

def check_outbound_ip():
    resp = requests.get("https://api.ipify.org?format=json", timeout=5)
    resp.raise_for_status()
    return resp.json()["ip"]

def check_ssl_expiry(domain, port=443):
    ctx = ssl.create_default_context()
    with socket.create_connection((domain, port), timeout=5) as sock:
        with ctx.wrap_socket(sock, server_hostname=domain) as ssock:
            cert = ssock.getpeercert()
    expires = datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    days_left = (expires - datetime.now(timezone.utc)).days
    return {"expires": expires.isoformat(), "days_left": days_left}

def check_reachable(url, timeout=4):
    try:
        resp = requests.get(url, timeout=timeout, allow_redirects=True)
        return {"reachable": True, "status_code": resp.status_code}
    except requests.RequestException as e:
        return {"reachable": False, "error": str(e)}

def geocode_location(query, limit=5):
    resp = requests.get(
        "https://geocoding-api.open-meteo.com/v1/search",
        params={"name": query, "count": limit, "language": "en", "format": "json"},
        timeout=6,
    )
    resp.raise_for_status()
    results = resp.json().get("results") or []
    return [
        {
            "name": r["name"],
            "country": r.get("country", ""),
            "admin1": r.get("admin1", ""),
            "latitude": r["latitude"],
            "longitude": r["longitude"],
        }
        for r in results
    ]

def check_weather(latitude, longitude, days=5):
    days = max(3, min(int(days or 5), 7))
    resp = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": latitude,
            "longitude": longitude,
            "daily": "weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "timezone": "auto",
            "forecast_days": days,
        },
        timeout=6,
    )
    resp.raise_for_status()
    data = resp.json()
    daily = data.get("daily", {})

    result_days = []
    for i, d in enumerate(daily.get("time", [])):
        code = daily.get("weathercode", [None] * len(daily["time"]))[i]
        description, icon = WEATHER_CODES.get(code, ("Unknown", "fa-cloud-question"))
        result_days.append({
            "date": d,
            "code": code,
            "description": description,
            "icon": icon,
            "temp_max": daily.get("temperature_2m_max", [None])[i],
            "temp_min": daily.get("temperature_2m_min", [None])[i],
            "precipitation_probability": daily.get("precipitation_probability_max", [None])[i],
        })

    return {"days": result_days}
