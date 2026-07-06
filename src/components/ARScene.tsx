"use client";

import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';

// Tell TypeScript about the custom model-viewer element
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        ar?: boolean;
        'ar-modes'?: string;
        'camera-controls'?: boolean;
        autoplay?: boolean;
        animationName?: string;
        'shadow-intensity'?: string;
        alt?: string;
      };
    }
  }
}

export default function ARScene() {
  const [treeVisible, setTreeVisible] = useState(false);
  const [currentAnim, setCurrentAnim] = useState('Idle'); // RobotExpressive has 'Idle' and 'Walking'
  const modelRef = useRef<any>(null);

  // Example mocked data (same as before)
  const familyData = {
    name: "John Doe",
    lifespan: "1940 - 2023",
    relations: [
      { type: "Spouse", name: "Jane Doe" },
      { type: "Child", name: "Alice Smith" },
      { type: "Child", name: "Robert Doe" }
    ]
  };

  const handleWalk = () => {
    setCurrentAnim('Walking');
    // Stop walking after 3 seconds
    setTimeout(() => {
      setCurrentAnim('Idle');
    }, 3000);
  };

  return (
    <>
      <div className="ar-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', backgroundColor: '#000' }}>
        
        {/* Google Model Viewer - Handles 3D rendering and Native AR delegation */}
        <model-viewer
          ref={modelRef}
          src="/RobotExpressive.glb"
          ar
          ar-modes="scene-viewer webxr quick-look"
          camera-controls
          autoplay
          animationName={currentAnim}
          shadow-intensity="1"
          alt="A 3D model of an avatar"
          style={{ width: '100%', height: '100%', outline: 'none' }}
        >
          {/* Custom AR Button overlay shown inside the web viewer */}
          <button slot="ar-button" className="gold-btn" style={{ position: 'absolute', bottom: '150px', left: '50%', transform: 'translateX(-50%)' }}>
            View in your space (AR)
          </button>
        </model-viewer>

      </div>

      {/* HTML Overlay UI (Visible in web view, but disappears when native Scene Viewer opens) */}
      <div className="overlay-ui" style={{ pointerEvents: 'auto', bottom: '40px', gap: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        
        <div style={{ display: 'flex', gap: '15px' }}>
          <button className="gold-btn" onClick={() => setTreeVisible(!treeVisible)}>
            Toggle Family Tree
          </button>
          
          <button className="gold-btn" onClick={handleWalk}>
            Walk Forward
          </button>

          <button className="gold-btn" onClick={() => window.location.reload()}>
            Exit
          </button>
        </div>

        {treeVisible && (
          <div className="family-tree-panel">
            <h3>{familyData.name}</h3>
            <p className="lifespan">{familyData.lifespan}</p>
            <div className="divider"></div>
            <ul className="relations-list">
              {familyData.relations.map((rel, i) => (
                <li key={i}>
                  <span className="rel-type">{rel.type}:</span> {rel.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
