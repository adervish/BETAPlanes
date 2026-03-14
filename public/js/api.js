const API = {
  async getPlanes() {
    const res = await fetch("/api/planes");
    return res.json();
  },
  async getFlights(tail) {
    const res = await fetch("/api/flights?tail=" + encodeURIComponent(tail));
    return res.json();
  },
  async getTrack(flightId) {
    const res = await fetch("/api/tracks/" + encodeURIComponent(flightId));
    return res.json();
  },
  async getStats() {
    const res = await fetch("/api/stats");
    return res.json();
  },
  async getDailyStats() {
    const res = await fetch("/api/stats/daily");
    return res.json();
  },
};
