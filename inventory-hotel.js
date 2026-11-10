/* Pins an open inventory hotel to its own template rows. */
(function(root){
  function belongs(base, hotel) {
    const name = String(hotel || '').trim();
    const rootName = String(base || '').trim();
    if (!rootName || !name) return false;
    return name === rootName || name.startsWith(rootName + ' ');
  }

  // Prefer a row whose hotel field actually belongs to this base.
  // A first-row match can name another hotel; never adopt that name.
  // With no row at all, 房務 keeps the historical bare-base fallback.
  function resolve(base, dept, rows) {
    const list = (rows || []).filter(row => row && row.baseName === base && row.deptName === dept);
    const owned = list.find(row => belongs(base, row.hotel));
    if (owned) return String(owned.hotel).trim();
    if (!list.length && (!dept || dept === '房務')) return String(base || '');
    return `${String(base || '').trim()} ${String(dept || '').trim()}`.trim();
  }

  const api = { belongs, resolve };
  root.InventoryHotel = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
