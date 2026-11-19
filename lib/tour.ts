/**
 * Recorrido «Cómo usar la app» (components/WhatsNew.tsx): se muestra una vez por versión y se reabre desde
 * Ajustes › Ayuda o Más › Cómo usar la app. Los 20 consejos por pantalla (CoachTip) se eliminaron en C7.9:
 * la ayuda ahora es el «?» de cada cabecera y los estados vacíos que explican qué hacer.
 */
const TOUR_KEY = "inventaria.tour.v4"; // v4 = reconstrucción C7 (5 lugares)

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === "1";
  } catch {
    return true;
  }
}
export function markTourSeen() {
  try {
    localStorage.setItem(TOUR_KEY, "1");
  } catch {
    /* sin almacenamiento: se vuelve a mostrar, sin más */
  }
}
