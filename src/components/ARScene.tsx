"use client";

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';

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

function createPawPrint() {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ 
    color: 0x00ffff, transparent: true, opacity: 0.8, depthWrite: false
  });
  const mainPad = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), material);
  mainPad.scale.set(1, 0.2, 1);
  group.add(mainPad);
  const toeGeo = new THREE.SphereGeometry(0.06, 16, 16);
  const toe1 = new THREE.Mesh(toeGeo, material); toe1.scale.set(1, 0.2, 1); toe1.position.set(-0.15, 0, 0.2); group.add(toe1);
  const toe2 = new THREE.Mesh(toeGeo, material); toe2.scale.set(1, 0.2, 1); toe2.position.set(0, 0, 0.25); group.add(toe2);
  const toe3 = new THREE.Mesh(toeGeo, material); toe3.scale.set(1, 0.2, 1); toe3.position.set(0.15, 0, 0.2); group.add(toe3);
  return group;
}

interface ARSceneProps {
  onExit?: () => void;
}

export default function ARScene({ onExit }: ARSceneProps) {
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

  const [guideMode, setGuideModeState] = useState<'robot' | 'tracks'>('robot');
  const guideModeRef = useRef<'robot' | 'tracks'>('robot');
  const setGuideMode = (mode: 'robot' | 'tracks') => {
    guideModeRef.current = mode;
    setGuideModeState(mode);
  };

  // Navigation Refs (Used inside requestAnimationFrame)
  const headingRef = useRef<number>(0);
  const targetLocationRef = useRef<{lat: number, lng: number} | null>(null);
  const currentLocationRef = useRef<{lat: number, lng: number} | null>(null);
  const lastPosRef = useRef<{lat: number, lng: number, time: number} | null>(null);
  
  const routeWaypointsRef = useRef<{lat: number, lng: number}[]>([]);
  const currentWaypointIndexRef = useRef<number>(0);
  const finalDestinationRef = useRef<{lat: number, lng: number} | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let isMounted = true;
    let animationFrameId: number;
    let localMixer: THREE.AnimationMixer | null = null;
    const clock = new THREE.Clock();

    // 1. (WebRTC removed - using native WebXR via ARButton instead)

    // 2. SETUP SENSORS (GPS & COMPASS)
    let initialHeading: number | null = null;
    const handleOrientation = (event: DeviceOrientationEvent) => {
      let alpha = event.alpha;
      let webkitHeading = (event as any).webkitCompassHeading;
      let heading = 0;
      if (webkitHeading != null) {
        heading = webkitHeading;
      } else if (alpha != null) {
        heading = 360 - alpha; // Rough Android mapping
      }
      headingRef.current = heading;
      if (initialHeading === null && heading !== 0) initialHeading = heading;
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

        if (finalDestinationRef.current && routeWaypointsRef.current.length > 0) {
          let target = routeWaypointsRef.current[currentWaypointIndexRef.current];
          if (!target) target = finalDestinationRef.current; 

          const distToWaypoint = getDistance(
            pos.coords.latitude, pos.coords.longitude,
            target.lat, target.lng
          );

          // Advance to next waypoint if within 8 meters
          if (distToWaypoint < 8 && currentWaypointIndexRef.current < routeWaypointsRef.current.length - 1) {
            currentWaypointIndexRef.current += 1;
            target = routeWaypointsRef.current[currentWaypointIndexRef.current];
          }
          
          targetLocationRef.current = target; // Feed current waypoint to the 3D compass

          let routeDist = getDistance(
            pos.coords.latitude, pos.coords.longitude,
            target.lat, target.lng
          );

          // Add the rest of the waypoints to get the true "walking route" distance
          for (let i = currentWaypointIndexRef.current; i < routeWaypointsRef.current.length - 1; i++) {
             routeDist += getDistance(
               routeWaypointsRef.current[i].lat, routeWaypointsRef.current[i].lng,
               routeWaypointsRef.current[i+1].lat, routeWaypointsRef.current[i+1].lng
             );
          }
          
          const distToFinal = routeWaypointsRef.current.length > 1 ? routeDist : getDistance(
            pos.coords.latitude, pos.coords.longitude,
            finalDestinationRef.current.lat, finalDestinationRef.current.lng
          );
          setDistance(Math.round(distToFinal));

          if (distToFinal < 5) {
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
    renderer.xr.enabled = true; // Enable WebXR
    
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);
    
    const arButton = ARButton.createButton(renderer, { requiredFeatures: ['hit-test'] });
    arButton.style.bottom = '120px'; // move it up so it doesn't overlap our UI
    arButton.id = 'ar-button';
    document.body.appendChild(arButton);

    // 4. LIGHTING & HIT-TESTING
    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 2);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(0, 2, 2);
    scene.add(dirLight);

    const reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    const controller = renderer.xr.getController(0);
    controller.addEventListener('select', () => {
      if (reticle.visible && avatarRef.current) {
        avatarRef.current.position.setFromMatrixPosition(reticle.matrix);
        tracksGroup.position.setFromMatrixPosition(reticle.matrix);
        setInstruction("Guide Placed!");
      }
    });
    scene.add(controller);

    let hitTestSource: XRHitTestSource | null = null;
    let hitTestSourceRequested = false;

    // --- ANIMAL TRACKS ---
    const tracksGroup = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const paw = createPawPrint();
      paw.position.set(
        (i % 2 === 0 ? 0.2 : -0.2), // staggered
        -1.5,                       // floor level
        (i * 0.8) + 1.0             // placed along +Z
      );
      tracksGroup.add(paw);
    }
    scene.add(tracksGroup);

    // 5. LOAD THE 3D AVATAR
    const loader = new GLTFLoader();
    loader.load('/RobotExpressive.glb', (gltf) => {
      if (!isMounted) return; 

      const avatar = gltf.scene;
      avatar.scale.set(0.6, 0.6, 0.6); 
      // Place out of view until placed by reticle
      avatar.position.set(0, -10, 0); 
      
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

    // 6. RENDER LOOP (WebXR requires setAnimationLoop)
    renderer.setAnimationLoop((timestamp, frame) => {
      if (!isMounted) return;
      
      const delta = clock.getDelta();
      const time = clock.getElapsedTime();
      
      if (localMixer) localMixer.update(delta);
      
      if (guideModeRef.current === 'robot') {
        if (avatarRef.current) avatarRef.current.visible = true;
        tracksGroup.visible = false;
      } else {
        if (avatarRef.current) avatarRef.current.visible = false;
        tracksGroup.visible = true;
        // Animate tracks
        tracksGroup.children.forEach((paw, index) => {
          const mat = (paw.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
          mat.opacity = 0.2 + Math.max(0, Math.sin(time * 4 - index * 0.8)) * 0.8;
          for (let j=1; j<=3; j++) ((paw.children[j] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = mat.opacity;
        });
      }

      // Hit-Testing Logic
      if (frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (hitTestSourceRequested === false && session && referenceSpace) {
          (session as any).requestReferenceSpace('viewer').then((refSpace: any) => {
            (session as any).requestHitTestSource({ space: refSpace }).then((source: any) => {
              hitTestSource = source;
            });
          });
          session.addEventListener('end', () => {
            hitTestSourceRequested = false;
            hitTestSource = null;
          });
          hitTestSourceRequested = true;
        }

        if (hitTestSource && referenceSpace) {
          const hitTestResults = frame.getHitTestResults(hitTestSource);
          if (hitTestResults.length > 0) {
            const hit = hitTestResults[0];
            const pose = hit.getPose(referenceSpace);
            if (pose) {
               reticle.visible = true;
               reticle.matrix.fromArray(pose.transform.matrix);
            }
          } else {
            reticle.visible = false;
          }
        }
      }

      // AR SMART COMPASS MATH
      if (targetLocationRef.current && currentLocationRef.current) {
        const bearing = getBearing(
          currentLocationRef.current.lat, currentLocationRef.current.lng,
          targetLocationRef.current.lat, targetLocationRef.current.lng
        );
        const baseHeading = initialHeading !== null ? initialHeading : headingRef.current;
        const diffDeg = bearing - baseHeading;
        const diffRad = diffDeg * (Math.PI / 180);
        const targetY = -diffRad + Math.PI; 
        
        if (avatarRef.current) {
          const currentY = avatarRef.current.rotation.y;
          avatarRef.current.rotation.y = currentY + (targetY - currentY) * 0.1;
        }
        
        const currentTY = tracksGroup.rotation.y;
        tracksGroup.rotation.y = currentTY + (targetY - currentTY) * 0.1;
      }

      renderer.render(scene, camera);
    });

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
      renderer.setAnimationLoop(null);
      navigator.geolocation.clearWatch(watchId);
      window.removeEventListener('deviceorientationabsolute', handleOrientation as any);
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('resize', onWindowResize);
      if (containerRef.current && renderer.domElement.parentNode) {
        containerRef.current.removeChild(renderer.domElement);
      }
      const arBtn = document.getElementById('ar-button');
      if (arBtn && arBtn.parentNode) arBtn.parentNode.removeChild(arBtn);
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

    finalDestinationRef.current = { lat, lng };

    if (!currentLocationRef.current) {
      setInstruction('Waiting for GPS signal...');
      return;
    }

    setInstruction('Calculating Route...');
    
    try {
      const startLng = currentLocationRef.current.lng;
      const startLat = currentLocationRef.current.lat;
      const res = await fetch(`https://router.project-osrm.org/route/v1/foot/${startLng},${startLat};${lng},${lat}?geometries=geojson`);
      const data = await res.json();
      
      if (data.routes && data.routes.length > 0) {
        const coords = data.routes[0].geometry.coordinates;
        routeWaypointsRef.current = coords.map((c: any) => ({ lng: c[0], lat: c[1] }));
        currentWaypointIndexRef.current = 1; 
        targetLocationRef.current = routeWaypointsRef.current[1] || routeWaypointsRef.current[0];
        setInstruction(`Route found! Follow Guide.`);
      } else {
        routeWaypointsRef.current = [{ lat, lng }];
        currentWaypointIndexRef.current = 0;
        targetLocationRef.current = { lat, lng };
        setInstruction('Direct Route Set');
      }
    } catch (err) {
      console.error(err);
      routeWaypointsRef.current = [{ lat, lng }];
      currentWaypointIndexRef.current = 0;
      targetLocationRef.current = { lat, lng };
      setInstruction('Offline Direct Route Set');
    }
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#000' }}>
      
      <div ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1 }} />

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

          <button className="gold-btn" style={{ fontSize: '0.8rem', padding: '10px', backgroundColor: '#38b000' }} onClick={() => setGuideMode(guideMode === 'robot' ? 'tracks' : 'robot')}>
            Mode: {guideMode === 'robot' ? 'Robot' : 'Tracks'}
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
