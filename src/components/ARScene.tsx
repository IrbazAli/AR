"use client";

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// --- MATH UTILITIES ---
function getBearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
            Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
  const brng = Math.atan2(y, x) * toDeg;
  return (brng + 360) % 360;
}

function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const phi1 = lat1 * Math.PI/180;
  const phi2 = lat2 * Math.PI/180;
  const deltaPhi = (lat2-lat1) * Math.PI/180;
  const deltaLambda = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

interface ARSceneProps {
  onExit?: () => void;
}

export default function ARScene({ onExit }: ARSceneProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Animation Refs
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const idleActionRef = useRef<THREE.AnimationAction | null>(null);
  const walkActionRef = useRef<THREE.AnimationAction | null>(null);
  const avatarRef = useRef<THREE.Group | null>(null);

  // Navigation State
  const [treeVisible, setTreeVisible] = useState(false);
  const [distance, setDistance] = useState<number | null>(null);
  const [instruction, setInstruction] = useState<string>('Standby');
  const [inputLat, setInputLat] = useState<string>('');
  const [inputLng, setInputLng] = useState<string>('');

  // Navigation Refs (Used inside requestAnimationFrame)
  const headingRef = useRef<number>(0);
  const targetLocationRef = useRef<{lat: number, lng: number} | null>(null);
  const currentLocationRef = useRef<{lat: number, lng: number} | null>(null);
  const lastPosRef = useRef<{lat: number, lng: number, time: number} | null>(null);

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

    // 2. SETUP SENSORS (GPS & COMPASS)
    const handleOrientation = (event: DeviceOrientationEvent) => {
      let alpha = event.alpha;
      let webkitHeading = (event as any).webkitCompassHeading;
      if (webkitHeading != null) {
        headingRef.current = webkitHeading;
      } else if (alpha != null) {
        headingRef.current = 360 - alpha; // Rough Android mapping
      }
    };
    window.addEventListener('deviceorientationabsolute', handleOrientation as any);
    window.addEventListener('deviceorientation', handleOrientation);

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        currentLocationRef.current = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        };

        const now = Date.now();
        let currentSpeed = pos.coords.speed || 0; 
        
        if (lastPosRef.current) {
          const distWalked = getDistance(
            lastPosRef.current.lat, lastPosRef.current.lng,
            pos.coords.latitude, pos.coords.longitude
          );
          const timeElapsed = (now - lastPosRef.current.time) / 1000; 
          
          if (timeElapsed > 0 && (pos.coords.speed === null || pos.coords.speed === undefined)) {
             currentSpeed = distWalked / timeElapsed;
          }
        }
        
        lastPosRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude, time: now };

        if (currentSpeed > 0.4) {
           if (walkActionRef.current && idleActionRef.current) {
             idleActionRef.current.stop();
             walkActionRef.current.play();
           }
        } else {
           if (walkActionRef.current && idleActionRef.current) {
             walkActionRef.current.stop();
             idleActionRef.current.play();
           }
        }

        if (targetLocationRef.current) {
          const dist = getDistance(
            pos.coords.latitude, pos.coords.longitude,
            targetLocationRef.current.lat, targetLocationRef.current.lng
          );
          setDistance(Math.round(dist));
          if (dist < 5) {
             setInstruction("You have arrived at the grave!");
             if (walkActionRef.current && idleActionRef.current) {
               walkActionRef.current.stop();
               idleActionRef.current.play();
             }
          } else {
             setInstruction(`Follow the Guide`);
          }
        }
      },
      (err) => console.warn("GPS Error", err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );

    // 3. SETUP THREE.JS OVERLAY
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    camera.position.set(0, 1.5, 3); 
    camera.lookAt(0, 1, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    
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
      if (!isMounted) return; 

      const avatar = gltf.scene;
      avatar.scale.set(0.6, 0.6, 0.6); 
      avatar.position.set(0, -0.5, 0); 
      
      // Face AWAY from the camera to act as a guide
      avatar.rotation.y = 0; 
      scene.add(avatar);
      avatarRef.current = avatar;

      localMixer = new THREE.AnimationMixer(avatar);
      mixerRef.current = localMixer;

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
      if (!isMounted) return;
      
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      
      if (localMixer) localMixer.update(delta);
      
      // AR SMART COMPASS MATH
      if (avatarRef.current && targetLocationRef.current && currentLocationRef.current) {
        const bearing = getBearing(
          currentLocationRef.current.lat, currentLocationRef.current.lng,
          targetLocationRef.current.lat, targetLocationRef.current.lng
        );
        // Calculate how much the user is turning away from the target
        const diffDeg = bearing - headingRef.current;
        const diffRad = diffDeg * (Math.PI / 180);
        
        // Rotate the avatar to point toward the destination relative to camera
        // Using lerp for smooth rotation
        const currentY = avatarRef.current.rotation.y;
        const targetY = -diffRad; 
        avatarRef.current.rotation.y = currentY + (targetY - currentY) * 0.1;
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
      isMounted = false;
      cancelAnimationFrame(animationFrameId);
      navigator.geolocation.clearWatch(watchId);
      window.removeEventListener('deviceorientationabsolute', handleOrientation as any);
      window.removeEventListener('deviceorientation', handleOrientation);
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

  const handleStartNav = async () => {
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      try {
        const p = await (DeviceOrientationEvent as any).requestPermission();
        if (p !== 'granted') return setInstruction('Compass permission denied.');
      } catch (err) { console.error(err); }
    }
    
    if (!inputLat || !inputLng) {
      setInstruction('Please enter valid coordinates.');
      return;
    }

    const lat = parseFloat(inputLat);
    const lng = parseFloat(inputLng);

    if (isNaN(lat) || isNaN(lng)) {
      setInstruction('Invalid coordinates format.');
      return;
    }

    targetLocationRef.current = { lat, lng };
    setInstruction(`Destination Set: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#000' }}>
      
      <video ref={videoRef} autoPlay playsInline muted style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 1 }} />
      <div ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 2 }} />

      {/* GPS Dashboard */}
      <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'rgba(0,0,0,0.6)', padding: '10px 20px', borderRadius: '15px', color: '#ffb703', border: '1px solid #ffb703', zIndex: 3, textAlign: 'center', minWidth: '250px' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>{instruction}</h3>
        {distance !== null && <p style={{ margin: '5px 0 0 0', fontSize: '1.2rem', fontWeight: 'bold' }}>{distance}m to go</p>}
      </div>

      {/* HTML Overlay UI */}
      <div className="overlay-ui" style={{ position: 'absolute', pointerEvents: 'auto', bottom: '10%', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', width: '90%', zIndex: 3 }}>
        {/* Input Form */}
        <div style={{ display: 'flex', gap: '10px', background: 'rgba(0,0,0,0.5)', padding: '10px', borderRadius: '10px', marginBottom: '10px' }}>
          <input 
            type="text" 
            placeholder="Lat" 
            value={inputLat} 
            onChange={(e) => setInputLat(e.target.value)} 
            style={{ width: '80px', padding: '5px' }} 
          />
          <input 
            type="text" 
            placeholder="Lng" 
            value={inputLng} 
            onChange={(e) => setInputLng(e.target.value)} 
            style={{ width: '80px', padding: '5px' }} 
          />
          <button className="gold-btn" style={{ fontSize: '0.8rem', padding: '5px 10px', backgroundColor: '#e85d04' }} onClick={handleStartNav}>
            Go
          </button>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <button className="gold-btn" style={{ fontSize: '0.8rem', padding: '10px' }} onClick={() => setTreeVisible(!treeVisible)}>
            Family Tree
          </button>

          <button className="gold-btn" style={{ fontSize: '0.8rem', padding: '10px' }} onClick={() => onExit ? onExit() : window.location.reload()}>
            Exit
          </button>
        </div>
      </div>

      {treeVisible && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', backgroundColor: 'white', padding: '20px', borderRadius: '10px', zIndex: 10 }}>
          <h2 style={{ color: 'black', marginTop: 0 }}>Akashic Family Tree</h2>
          <p style={{ color: 'gray' }}>Grandfather (1920-1990)</p>
          <button className="gold-btn" onClick={() => setTreeVisible(false)}>Close</button>
        </div>
      )}
    </div>
  );
}
