"use client";

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface ARSceneProps {
  onExit: () => void;
}

export default function ARScene({ onExit }: ARSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [treeVisible, setTreeVisible] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !overlayRef.current) return;

    // Inject Eruda mobile console for debugging
    if (!(window as any).eruda) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/eruda';
      script.onload = () => {
        (window as any).eruda.init();
        console.log("Eruda Mobile Console Initialized");
      };
      document.head.appendChild(script);
    }

    // SCENE SETUP
    const scene = new THREE.Scene();
    
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    containerRef.current.appendChild(renderer.domElement);

    // LIGHTS
    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    // RETICLE for hit testing
    const reticleGeometry = new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2);
    const reticleMaterial = new THREE.MeshBasicMaterial({ color: 0xd4af37 }); // gold reticle
    const reticle = new THREE.Mesh(reticleGeometry, reticleMaterial);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // AVATAR
    let avatar: THREE.Group | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    let walkAction: THREE.AnimationAction | null = null;
    let idleAction: THREE.AnimationAction | null = null;

    const loader = new GLTFLoader();
    loader.load('/RobotExpressive.glb', (gltf) => {
      avatar = gltf.scene;
      avatar.scale.set(0.5, 0.5, 0.5); // scale down robot
      avatar.visible = false;
      scene.add(avatar);

      mixer = new THREE.AnimationMixer(avatar);
      // RobotExpressive usually has animations: Idle, Walking, Running, etc.
      const animations = gltf.animations;
      
      const idleAnim = animations.find(a => a.name === 'Idle');
      const walkAnim = animations.find(a => a.name === 'Walking');

      if (idleAnim) {
        idleAction = mixer.clipAction(idleAnim);
        idleAction.play();
      }
        if (walkAnim) {
          walkAction = mixer.clipAction(walkAnim);
        }
      },
      undefined,
      (error) => {
        console.error('Error loading RobotExpressive.glb:', error);
      }
    );

    // AR BUTTON (Bare minimum configuration to ensure compatibility)
    const arButton = ARButton.createButton(renderer, {});
    document.body.appendChild(arButton);

    // CONTROLLER & HIT TEST
    const controller = renderer.xr.getController(0);
    scene.add(controller);

    let hitTestSource: XRHitTestSource | null = null;
    let hitTestSourceRequested = false;
    let avatarPlaced = false;

    controller.addEventListener('select', () => {
      let targetPos = new THREE.Vector3();
      let hasTarget = false;

      if (reticle.visible) {
        targetPos.setFromMatrixPosition(reticle.matrix);
        hasTarget = true;
      } else {
        // FALLBACK: If hit-test is unsupported, place 2 meters in front of the camera, 1.5m down (approx floor)
        const cameraDir = new THREE.Vector3();
        camera.getWorldDirection(cameraDir);
        cameraDir.y = 0;
        cameraDir.normalize();
        targetPos.copy(camera.position).add(cameraDir.multiplyScalar(2));
        targetPos.y -= 1.5; 
        hasTarget = true;
      }

      if (hasTarget) {
        if (!avatarPlaced && avatar) {
          // Initial placement
          avatar.position.copy(targetPos);
          const lookPos = new THREE.Vector3(camera.position.x, avatar.position.y, camera.position.z);
          avatar.lookAt(lookPos);
          avatar.visible = true;
          avatarPlaced = true;
          setTreeVisible(true); // Show family tree once placed
        } else if (avatar && avatarPlaced) {
          // Move avatar to new position
          placeAnimalTrack(targetPos);
          avatar.position.copy(targetPos);
          const lookPos = new THREE.Vector3(camera.position.x, avatar.position.y, camera.position.z);
          avatar.lookAt(lookPos);
          
          if (walkAction && idleAction) {
            idleAction.stop();
            walkAction.play();
            setTimeout(() => {
              walkAction?.stop();
              idleAction?.play();
            }, 1000);
          }
        }
      }
    });

    // ANIMAL TRACKS LOGIC
    const tracks: THREE.Mesh[] = [];
    const trackGeometry = new THREE.CircleGeometry(0.05, 32).rotateX(-Math.PI / 2);
    const trackMaterial = new THREE.MeshBasicMaterial({ color: 0xd4af37, transparent: true, opacity: 0.8 });
    
    function placeAnimalTrack(position: THREE.Vector3) {
      const track = new THREE.Mesh(trackGeometry, trackMaterial);
      track.position.copy(position);
      // Lift slightly above floor to prevent z-fighting
      track.position.y += 0.01;
      scene.add(track);
      tracks.push(track);
      
      // Fade out and remove after 5 seconds
      setTimeout(() => {
        scene.remove(track);
      }, 5000);
    }

    // RENDER LOOP
    const clock = new THREE.Clock();

    function render(timestamp: number, frame?: XRFrame) {
      if (frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (session && hitTestSourceRequested === false) {
          session.requestReferenceSpace('viewer').then((refSpace) => {
            if ((session as any).requestHitTestSource) {
              (session as any).requestHitTestSource({ space: refSpace }).then((source: any) => {
                hitTestSource = source;
              });
            }
          });
          session.addEventListener('end', () => {
            hitTestSourceRequested = false;
            hitTestSource = null;
            onExit();
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

      if (mixer) {
        mixer.update(clock.getDelta());
      }

      renderer.render(scene, camera);
    }

    renderer.setAnimationLoop(render);

    // CLEANUP
    return () => {
      renderer.setAnimationLoop(null);
      if (containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
      if (arButton.parentNode) {
        arButton.parentNode.removeChild(arButton);
      }
    };
  }, [onExit]);

  return (
    <>
      <div ref={containerRef} className="ar-container" />
      
      {/* DOM Overlay container required for WebXR UI */}
      <div ref={overlayRef}>
        {/* We make it flex/block when AR starts, but Three.js DOM Overlay requires the root to be hidden/styled carefully */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          
          {treeVisible && (
            <div id="family-tree-overlay" style={{ display: 'block', pointerEvents: 'auto' }}>
              <h3>Family Tree</h3>
              <div className="tree-node">
                <strong>John Doe (Guide)</strong>
              </div>
              <div style={{ height: '20px', width: '2px', background: 'white', margin: '0 auto' }}></div>
              <div className="tree-node">
                Jane Doe (Wife)
              </div>
              <div style={{ height: '20px', width: '2px', background: 'white', margin: '0 auto' }}></div>
              <div className="tree-node">
                Michael Doe (Son)
              </div>
              
              <button 
                className="gold-btn" 
                style={{ marginTop: '15px', padding: '5px 15px', fontSize: '0.9rem' }}
                onClick={() => setTreeVisible(false)}
              >
                Close Tree
              </button>
            </div>
          )}

          <div className="overlay-ui">
            <button onClick={() => setTreeVisible(!treeVisible)}>
              Toggle Family Tree
            </button>
            <button onClick={() => document.getElementById('ar-button')?.click()}>
              Exit AR
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
