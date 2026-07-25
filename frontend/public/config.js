/** Меняется за 2 секунды на сервере — без пересборки frontend */
window.__GP_CONFIG__ = {
  // Backend API. Пусто = тот же origin (/api через nginx или vite proxy)
  API_URL: "",
  // Offline AI (Python). На сервере: http://IP:5005 или http://127.0.0.1:5005
  OFFLINE_AI_URL: "http://127.0.0.1:5005",
  APP_TITLE: "Graph Platform"
};
