// Serveur protégé par mot de passe : session expirée, on revient à la page de connexion.
const natif = globalThis.fetch.bind(globalThis);
let recharge = false;
globalThis.fetch = async (...a) => {
  const res = await natif(...a);
  if (res.status === 401 && res.headers.get("X-Connexion") && !recharge) {
    recharge = true;
    location.reload();
  }
  return res;
};

/** Montre « Se déconnecter » seulement quand le serveur a un mot de passe. */
export async function preparerDeconnexion(bouton) {
  bouton.addEventListener("click", async () => {
    await natif("api/deconnexion", { method: "POST" }).catch(() => {});
    location.reload();
  });
  try { bouton.hidden = !(await (await natif("api/etat")).json()).connexion; } catch { /* reste caché */ }
}
