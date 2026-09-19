import React, { useEffect, useRef } from 'react';
import { t } from '../i18n/index.js';

export default function ListingMap({ lat, lng, label }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current || !window.L) return;
    const map = window.L.map(mapRef.current, {
      center: [lat, lng], zoom: 14,
      zoomControl: false, attributionControl: false,
      dragging: false, scrollWheelZoom: false, touchZoom: false, doubleClickZoom: false
    });
    window.L.tileLayer("https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=pk.eyJ1IjoiYWRqZXkiLCJhIjoiY21vN2F1YW1yMDU3YzJ4cG1kYmh0ejF5ayJ9.YbixttiQd4lG5o7mGvNulg", { maxZoom: 18, tileSize: 512, zoomOffset: -1, attribution: '© Mapbox' }).addTo(map);
    window.L.circle([lat, lng], { radius: 300, color: "#0ea5e9", fillColor: "#0ea5e9", fillOpacity: 0.15, weight: 2 }).addTo(map);
    mapInstanceRef.current = map;
    return () => { map.remove(); mapInstanceRef.current = null; };
  }, [lat, lng]);
  return (
    <div style={{marginTop:8}}>
      <div className="divider"/>
      <div className="sec-title">{t("title.location")}</div>
      <div style={{fontSize:11,color:"var(--muted)",marginBottom:8}}>{label} · approximate zone</div>
      <div ref={mapRef} style={{width:"100%",height:180,borderRadius:12,overflow:"hidden"}}/>
    </div>
  );
}
