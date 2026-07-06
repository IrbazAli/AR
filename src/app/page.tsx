"use client";

import { useState } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import the AR scene so it only loads on the client side
const ARScene = dynamic(() => import('../components/ARScene'), { ssr: false });

export default function Home() {
  const [arMode, setArMode] = useState(false);

  if (arMode) {
    return <ARScene onExit={() => setArMode(false)} />;
  }

  return (
    <main className="landing-container">
      <h1 className="landing-title">AKASHA RELIC TECH</h1>
      <p className="landing-subtitle">
        Enter the permanent digital memorial space. Experience presence through augmented reality.
      </p>
      
      <div style={{ display: 'flex', gap: '20px', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '20px', borderRadius: '8px', border: '1px solid #d4af37' }}>
          <h3 style={{ color: '#d4af37', marginBottom: '10px', fontWeight: '300' }}>Demo Profile Selected</h3>
          <p>Avatar: Nun Guide (Placeholder Robot)</p>
          <p>Features: Walking, Animal Tracks, Family Tree</p>
        </div>
        
        <button className="gold-btn" onClick={() => setArMode(true)}>
          Enter AR Memorial
        </button>
      </div>
    </main>
  );
}
