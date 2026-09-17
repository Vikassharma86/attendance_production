function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371008.8;
  const toRad = d => d * Math.PI / 180;
  const p1 = toRad(lat1), p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function validCoordinate(n) {
  return Number.isFinite(n);
}

function verifyLocation(lat, lng, accuracy, office) {
  const distance = haversineMeters(lat, lng, Number(office.latitude), Number(office.longitude));
  const accuracyOk = accuracy == null || accuracy <= Number(office.max_accuracy_meters);
  const inside = distance <= Number(office.radius_meters) && accuracyOk;
  return { distance, accuracyOk, inside };
}

module.exports = { haversineMeters, verifyLocation, validCoordinate };
