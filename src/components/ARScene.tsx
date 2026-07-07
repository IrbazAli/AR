"use client";

import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export default function ARScene() {
  const [treeVisible, setTreeVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Animation refs
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const walkActionRef = useRef<THREE.AnimationAction | null>(null);
  const idleActionRef = useRef<THREE.AnimationAction | null>(null);
  const clockRef = useRef(new THREE.Clock());

  // Example mocked data
  const familyData = {
    name: "John Doe",
    lifespan: "1940 - 2023",
    relations: [
      { type: "Spouse", name: "Jane Doe" },
      { type: "Child", name: "Alice Smith" },
      { type: "Child", name: "Robert Doe" }
    ]
  };

  useEffect(() => {
    if (!containerRef.current || !videoRef.current) return;

    let isMounted = true;
    let animationFrameId: number;
    let localMixer: THREE.AnimationMixer | null = null;
    const clock = new THREE.Clock();

    // 1. SETUP RAW CAMERA STREAM (WebRTC)
    navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: { ideal: "environment" } } 
    })
    .then((stream) => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    })
    .catch((err) => {
      console.error("Camera access denied or unavailable", err);
    });

    // 2. SETUP THREE.JS OVERLAY
    const scene = new THREE.Scene();
    
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    // Position camera exactly where it worked previously
    camera.position.set(0, 1.5, 3); 
    camera.lookAt(0, 1, 0); // Lock the camera to always look at the center

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    
    // Force clear container to prevent Strict Mode duplicates
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);

    // 4. LIGHTING
    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 2);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(0, 2, 2);
    scene.add(dirLight);

    // 5. LOAD THE 3D AVATAR
    const loader = new GLTFLoader();
    loader.load('/RobotExpressive.glb', (gltf) => {
      if (!isMounted) return; // Abort if React unmounted while downloading!

      const avatar = gltf.scene;
      avatar.scale.set(0.6, 0.6, 0.6); 
      // Place the avatar right below the center point
      avatar.position.set(0, -0.5, 0); 
      
      // Face the camera directly
      avatar.rotation.y = Math.PI; 
      scene.add(avatar);

      // Handle Animations
      localMixer = new THREE.AnimationMixer(avatar);
      mixerRef.current = localMixer; // Expose for walk button

      const idleAnim = gltf.animations.find((a) => a.name.toLowerCase().includes('idle'));
      const walkAnim = gltf.animations.find((a) => a.name.toLowerCase().includes('walk'));

      if (idleAnim) {
        const idleAction = localMixer.clipAction(idleAnim);
        idleAction.play();
        idleActionRef.current = idleAction;
      }
      if (walkAnim) {
        walkActionRef.current = localMixer.clipAction(walkAnim);
      }
    });

    // 6. RENDER LOOP
    const animate = () => {
      if (!isMounted) return; // Bulletproof kill-switch for Strict Mode
      
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      
      if (localMixer) {
        localMixer.update(delta);
      }
      
      renderer.render(scene, camera);
    };
    animate();

    // 7. HANDLE RESIZE
    const onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onWindowResize);

    // 8. CLEANUP
    return () => {
      isMounted = false; // Trigger kill-switch
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', onWindowResize);
      if (containerRef.current && renderer.domElement.parentNode) {
        containerRef.current.removeChild(renderer.domElement);
      }
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, []);

  const handleWalk = () => {
    if (walkActionRef.current && idleActionRef.current) {
      idleActionRef.current.stop();
      walkActionRef.current.play();
      
      // Stop walking after 3 seconds
      setTimeout(() => {
        walkActionRef.current?.stop();
        idleActionRef.current?.play();
      }, 3000);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#000' }}>
      
      {/* 1. Raw Back-Camera Video Feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          zIndex: 1
        }}
      />

      {/* 2. Transparent Three.js Canvas Overlay */}
      <div 
        ref={containerRef} 
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 2 // Canvas sits ABOVE the video
        }}
      />

      {/* 3. HTML Overlay UI */}
      <div 
        className="overlay-ui" 
        style={{ 
          position: 'absolute',
          pointerEvents: 'auto', 
          bottom: '10%', // Raised slightly so it is not hidden by taskbars
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center',
          gap: '15px',
          width: '90%',
          zIndex: 3 // UI sits ABOVE the Canvas
        }}
      >
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <button className="gold-btn" style={{ fontSize: '0.8rem', padding: '10px' }} onClick={() => setTreeVisible(!treeVisible)}>
            Toggle Tree
          </button>
          
          <button className="gold-btn" style={{ fontSize: '0.8rem', padding: '10px' }} onClick={handleWalk}>
            Walk Forward
          </button>

          <button className="gold-btn" style={{ fontSize: '0.8rem', padding: '10px' }} onClick={() => window.location.reload()}>
            Exit AR
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
    </div>
  );
}
