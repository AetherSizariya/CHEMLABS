import React, { useRef, useState, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Text, DragControls, TransformControls, Grid, Billboard, Html } from '@react-three/drei';
import * as THREE from 'three';
import { DeskItem } from '../types';
import { sumLiquidVolumeMl } from '../lib/quantityDisplay';



const GlassMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xe6f2ff,
  metalness: 0.1,
  roughness: 0.05,
  transparent: true,
  transmission: 0.95,
  opacity: 1.0,
  ior: 1.5,
  thickness: 0.05,
  side: THREE.DoubleSide,
  depthWrite: false
});

const LiquidMaterial = (color: string) => {
  return new THREE.MeshStandardMaterial({
    color: color,
    opacity: 0.85,
    metalness: 0,
    roughness: 0.2,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
  });
};

const Liquid3D = ({ shape, radius, height, fillRatio, color, posX, posZ }: any) => {
  const planeRef = useRef(new THREE.Plane(new THREE.Vector3(0, -1, 0), 0));
  const matRef = useRef(LiquidMaterial(color));
  
  React.useEffect(() => {
    matRef.current = LiquidMaterial(color);
    matRef.current.clippingPlanes = [planeRef.current];
    matRef.current.clipIntersection = false;
  }, [color]);

  useFrame(() => {
    planeRef.current.normal.copy(new THREE.Vector3(0, -1, 0));
    planeRef.current.constant = (height * fillRatio);
  });

  if (fillRatio <= 0) return null;

  return (
    <group>
      {shape === 'cylinder' && (
        <mesh position={[0, height / 2, 0]}>
          <cylinderGeometry args={[radius * 0.95, radius * 0.95, height, 32]} />
          <primitive object={matRef.current} attach="material" />
        </mesh>
      )}
      {shape === 'sphere_bottom' && (
        <mesh position={[0, radius, 0]}>
          <sphereGeometry args={[radius * 0.95, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <primitive object={matRef.current} attach="material" />
        </mesh>
      )}
      {shape === 'cone_top' && (
        <mesh position={[0, height / 2, 0]}>
           <cylinderGeometry args={[radius * 0.2, radius * 0.95, height, 32]} />
           <primitive object={matRef.current} attach="material" />
        </mesh>
      )}
      {shape === 'flat_dish' && (
        <mesh position={[0, height / 2, 0]}>
           <cylinderGeometry args={[radius * 0.95, radius * 0.95, height, 32]} />
           <primitive object={matRef.current} attach="material" />
        </mesh>
      )}
      {shape === 'pipette' && (
        <mesh position={[0, height / 2, 0]}>
           <cylinderGeometry args={[radius * 0.95, radius * 0.95, height, 16]} />
           <primitive object={matRef.current} attach="material" />
        </mesh>
      )}
    </group>
  );
};





const GasEffect = ({ color }: { color: string }) => {
  const groupRef = useRef<THREE.Group>(null);
  
  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.children.forEach((child, i) => {
        child.position.y += 0.02;
        if (child.position.y > 1.5) {
          child.position.y = 0;
          child.position.x = (Math.random() - 0.5) * 0.4;
          child.position.z = (Math.random() - 0.5) * 0.4;
        }
        child.rotation.x += 0.01;
        child.rotation.y += 0.01;
      });
    }
  });

  return (
    <group ref={groupRef}>
      {[...Array(15)].map((_, i) => (
        <mesh 
          key={i} 
          position={[(Math.random() - 0.5) * 0.4, Math.random() * 1.5, (Math.random() - 0.5) * 0.4]}
        >
          <sphereGeometry args={[0.05 + Math.random() * 0.05, 8, 8]} />
          <meshStandardMaterial color={color} transparent opacity={0.3} roughness={1} />
        </mesh>
      ))}
    </group>
  );
};

const PrecipitateModel = ({ item }: { item: DeskItem }) => {
  const solidContents = item.contents?.filter(c => c.chemical.state === 'solid') || [];
  const hasSolid = solidContents.length > 0;
  if (!item.hasPrecipitate && !hasSolid) return null;
  
  const { shape, radius, height } = item.equipment;
  const color = item.hasPrecipitate ? (item.precipitateColor || '#ffffff') : (solidContents[0]?.chemical.defaultColor || '#ffffff');
  
  // Custom graphics for specific solids
  if (!item.hasPrecipitate && hasSolid && solidContents.length === 1) {
     const chemName = solidContents[0].chemical.name.toLowerCase();
     if (chemName.includes('magnesium ribbon')) {
        return (
           <mesh position={[0, radius * 0.1, 0]} rotation={[0, 0, Math.PI / 4]}>
              <torusGeometry args={[radius * 0.4, 0.02, 16, 100, Math.PI]} />
              <meshStandardMaterial color="#c0c0c0" metalness={0.8} roughness={0.2} side={THREE.DoubleSide} />
           </mesh>
        );
     }
     if (chemName.includes('coal') || chemName.includes('charcoal')) {
        return (
           <mesh position={[0, radius * 0.2, 0]}>
              <dodecahedronGeometry args={[radius * 0.5, 0]} />
              <meshStandardMaterial color="#222222" roughness={1.0} />
           </mesh>
        );
     }
  }

  let solidAmount = solidContents.reduce((sum, c) => sum + c.amount, 0);
  if (item.hasPrecipitate) solidAmount += 5; // Arbitrary visual amount for precipitate
  const solidHeight = item.equipment.capacity > 0 ? Math.max(0.02, Math.min(0.2, (solidAmount / item.equipment.capacity) * height)) : 0.05;
  
  let yPos = solidHeight / 2;
  let args: any = [radius * 0.9, radius * 0.9, 0.05, 32];
  
  if (shape === 'sphere_bottom') {
    args = [radius * 0.6, radius * 0.2, 0.1, 32];
    yPos = radius * 0.1;
  } else if (shape === 'cone_top') {
    args = [radius * 0.9, radius * 0.9, 0.05, 32];
  } else if (shape === 'flat_dish') {
    args = [radius * 0.9, radius * 0.9, 0.02, 32];
    yPos = 0.02;
  }
  
  return (
    <mesh position={[0, yPos, 0]}>
      <cylinderGeometry args={args} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  );
};


const MetalMaterial = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.2 });
const PlasticMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.1, roughness: 0.8 });
const DarkPlasticMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.2, roughness: 0.6 });
const ScreenMaterial = new THREE.MeshBasicMaterial({ color: 0x88ff88 });

// Realistic-ish layered, flickering flame (replaces the old flat blue cone).
// Uses several nested, semi-transparent cones in warm colors with per-frame
// scale/wobble jitter driven by layered sine waves + a touch of randomness
// so it reads as a living flame instead of a static shape.
const Flame = ({ dazzling = false }: { dazzling?: boolean }) => {
  const outerRef = useRef<THREE.Mesh>(null);
  const midRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const jitter = (Math.random() - 0.5) * 0.06;
    const flickerXZ = 0.85 + Math.sin(t * 17) * 0.08 + Math.sin(t * 29 + 1.3) * 0.05 + jitter;
    const flickerY = 1 + Math.sin(t * 11 + 0.4) * 0.12 + Math.sin(t * 23) * 0.05;

    if (outerRef.current) outerRef.current.scale.set(flickerXZ, flickerY, flickerXZ);
    if (midRef.current) midRef.current.scale.set(flickerXZ * 0.95, flickerY * 1.05, flickerXZ * 0.95);
    if (innerRef.current) innerRef.current.scale.set(flickerXZ * 0.9, flickerY * 1.1, flickerXZ * 0.9);
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(t * 4) * 0.15;
      groupRef.current.position.x = Math.sin(t * 6) * 0.005;
      groupRef.current.position.z = Math.cos(t * 5) * 0.005;
    }
  });

  const outerColor = dazzling ? '#f5faff' : '#ff6a00';
  const midColor = dazzling ? '#ffffff' : '#ffb703';
  const innerColor = dazzling ? '#ffffff' : '#fff6cc';

  return (
    <group ref={groupRef}>
      <mesh ref={outerRef} position={[0, 0.11, 0]}>
        <coneGeometry args={[0.09, 0.32, 16]} />
        <meshBasicMaterial color={outerColor} transparent opacity={0.45} depthWrite={false} />
      </mesh>
      <mesh ref={midRef} position={[0, 0.08, 0]}>
        <coneGeometry args={[0.06, 0.24, 16]} />
        <meshBasicMaterial color={midColor} transparent opacity={0.7} depthWrite={false} />
      </mesh>
      <mesh ref={innerRef} position={[0, 0.045, 0]}>
        <coneGeometry args={[0.032, 0.16, 16]} />
        <meshBasicMaterial color={innerColor} transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <pointLight
        color={dazzling ? '#ffffff' : '#ff9500'}
        intensity={dazzling ? 2.2 : 1.1}
        distance={1.8}
      />
    </group>
  );
};

const EquipmentModel = ({ item, allItems }: { item: DeskItem, allItems: DeskItem[] }) => {
  if (item.isExploded) {
    return (
      <group>
        <Text position={[0, 0.5, 0]} color="red" fontSize={0.3}>
          EXPLODED!
        </Text>
        <mesh position={[0, 0.1, 0]}>
          <boxGeometry args={[0.5, 0.2, 0.5]} />
          <meshStandardMaterial color="#333" />
        </mesh>
      </group>
    );
  }

  const { shape, radius, height } = item.equipment;
  const liquidAmount = item.liquidVolumeMl ?? sumLiquidVolumeMl(item.contents);
  const fillRatio = item.equipment.capacity > 0 ? Math.min(liquidAmount / item.equipment.capacity, 1) : 0;
  const liquidMat = LiquidMaterial(item.liquidColor || '#a0d8ef');

  // Logic for meters
  let readingText = "";
  if (shape === 'meter_temp' || shape === 'meter_ph' || shape === 'meter_cond' || shape === 'balance' || shape === 'box') {
    // find closest item
    let closestItem = null;
    let minDist = 3.0;
    for (const other of allItems) {
      if (other.id !== item.id) {
        const dist = Math.hypot(other.position[0] - item.position[0], other.position[2] - item.position[2]);
        if (dist < minDist) {
          minDist = dist;
          closestItem = other;
        }
      }
    }
    
        if (shape === 'meter_temp') {
      readingText = closestItem?.temperature ? `${closestItem.temperature.toFixed(1)}°C` : "22.0°C";
    } else if (shape === 'meter_ph') {
      let ph = 7.0;
      if (closestItem && closestItem.contents) {
         let hPlus = 1e-7;
         let ohMinus = 1e-7;
         let totalVol = closestItem.liquidVolumeMl ?? sumLiquidVolumeMl(closestItem.contents);
         if (totalVol === 0) totalVol = 100; // fallback if only solids are present, assume 100ml water
         
         for (const c of closestItem.contents) {
            const name = c.chemical.name.toLowerCase();
            const formula = c.chemical.formula || "";
            let mm = 100;
            if (name.includes('hydrochloric') || formula === 'HCl') mm = 36.5;
            else if (name.includes('sulfuric') || formula === 'H2SO4') mm = 98;
            else if (name.includes('nitric') || formula === 'HNO3') mm = 63;
            else if (name.includes('sodium hydroxide') || formula === 'NaOH') mm = 40;
            else if (name.includes('potassium hydroxide') || formula === 'KOH') mm = 56;
            else if (name.includes('ammonia') || formula === 'NH3') mm = 17;
            else if (name.includes('acetic') || name.includes('ethanoic') || formula === 'CH3COOH') mm = 60;
            
            const moles = c.amount / mm;
            const molarity = moles / (totalVol / 1000); // mol/L

            if (name.includes('hydrochloric') || formula === 'HCl' || name.includes('nitric') || formula === 'HNO3' || formula === 'HBr' || formula === 'HI' || formula === 'HClO4') {
               hPlus += molarity;
            } else if (name.includes('sulfuric') || formula === 'H2SO4') {
               hPlus += molarity * 2;
            } else if (name.includes('acetic') || formula === 'CH3COOH') {
               hPlus += Math.sqrt(1.8e-5 * molarity);
            } else if (name.includes('hydroxide') || formula === 'NaOH' || formula === 'KOH' || formula === 'LiOH') {
               ohMinus += molarity;
            } else if (formula === 'Ba(OH)2' || formula === 'Ca(OH)2') {
               ohMinus += molarity * 2;
            } else if (name.includes('ammonia') || formula === 'NH3') {
               ohMinus += Math.sqrt(1.8e-5 * molarity);
            }
         }
         
         if (hPlus > ohMinus) {
            hPlus = hPlus - ohMinus;
            ph = -Math.log10(hPlus);
         } else if (ohMinus > hPlus) {
            ohMinus = ohMinus - hPlus;
            ph = 14 + Math.log10(ohMinus);
         }
         
         if (ph < 0) ph = 0;
         if (ph > 14) ph = 14;
      }
      readingText = closestItem ? `pH ${ph.toFixed(2)}` : 'pH --';
    } else if (shape === 'meter_cond') {
      let cond = 0;
      if (closestItem && closestItem.contents) {
         let totalIons = 0;
         let totalVol = closestItem.liquidVolumeMl ?? sumLiquidVolumeMl(closestItem.contents);
         if (totalVol === 0) totalVol = 100;
         for (const c of closestItem.contents) {
            const name = c.chemical.name.toLowerCase();
            if (name.includes('acid') || name.includes('hydroxide') || name.includes('sodium') || name.includes('potassium') || name.includes('chloride') || name.includes('sulfate') || name.includes('nitrate')) {
               totalIons += c.amount;
            }
         }
         const conc = totalIons / totalVol;
         cond = Math.floor(conc * 10000); 
      }
      readingText = closestItem ? `${cond} µS` : '-- µS';
    } else if (shape === 'balance') {
      const w = closestItem ? ((closestItem.liquidVolumeMl ?? sumLiquidVolumeMl(closestItem.contents)) + closestItem.equipment.capacity * 0.1) : 0;
      const tare = item.reading || 0;
      readingText = closestItem ? `${(w - tare).toFixed(2)}g` : '0.00g';
    }
  }

  return (
    <group>
      {/* 1. Standard Glassware Containers */}
      {shape === 'cylinder' && (
        <group>
          <mesh material={GlassMaterial} position={[0, height / 2, 0]}>
            <cylinderGeometry args={[radius, radius, height, 32, 1, true]} />
          </mesh>
          <mesh material={GlassMaterial} position={[0, 0, 0]}>
            <cylinderGeometry args={[radius, radius, 0.05, 32]} />
          </mesh>
          <Liquid3D shape={shape} radius={radius} height={height} fillRatio={fillRatio} color={item.liquidColor || "#a0d8ef"} posX={item.position[0]} posZ={item.position[2]} />
        </group>
      )}

      {shape === 'cone_top' && (
        <group>
          <mesh material={GlassMaterial} position={[0, height * 0.4, 0]}>
             <cylinderGeometry args={[radius * 0.3, radius, height * 0.8, 32, 1, true]} />
          </mesh>
          <mesh material={GlassMaterial} position={[0, height * 0.9, 0]}>
             <cylinderGeometry args={[radius * 0.3, radius * 0.3, height * 0.2, 32, 1, true]} />
          </mesh>
          <mesh material={GlassMaterial} position={[0, 0, 0]}>
            <cylinderGeometry args={[radius, radius, 0.05, 32]} />
          </mesh>
          <Liquid3D shape={shape} radius={radius} height={height} fillRatio={fillRatio} color={item.liquidColor || "#a0d8ef"} posX={item.position[0]} posZ={item.position[2]} />
        </group>
      )}

      {shape === 'sphere_bottom' && (
        <group>
          <mesh material={GlassMaterial} position={[0, radius, 0]}>
            <sphereGeometry args={[radius, 32, 32, 0, Math.PI * 2, 0, Math.PI * 0.8]} />
          </mesh>
          <mesh material={GlassMaterial} position={[0, radius + height/2, 0]}>
            <cylinderGeometry args={[radius * 0.3, radius * 0.3, height, 32, 1, true]} />
          </mesh>
           <Liquid3D shape={shape} radius={radius} height={height} fillRatio={fillRatio} color={item.liquidColor || "#a0d8ef"} posX={item.position[0]} posZ={item.position[2]} />
        </group>
      )}

      {shape === 'flat_dish' && (
        <group>
           <mesh material={GlassMaterial} position={[0, height / 2, 0]}>
            <cylinderGeometry args={[radius, radius, height, 32, 1, true]} />
          </mesh>
          <mesh material={GlassMaterial} position={[0, 0, 0]}>
            <cylinderGeometry args={[radius, radius, 0.05, 32]} />
          </mesh>
          <Liquid3D shape={shape} radius={radius} height={height} fillRatio={fillRatio} color={item.liquidColor || "#a0d8ef"} posX={item.position[0]} posZ={item.position[2]} />
        </group>
      )}

      {/* 2. Burners and Heaters */}
      {shape === 'burner' && (
        <group>
          {item.equipment.name === 'Candle' ? (
            <>
              <mesh material={new THREE.MeshStandardMaterial({ color: 0xffffee, roughness: 0.9 })} position={[0, height/2, 0]}>
                <cylinderGeometry args={[radius, radius, height, 32]} />
              </mesh>
              <mesh material={new THREE.MeshStandardMaterial({ color: 0x222222 })} position={[0, height + 0.05, 0]}>
                <cylinderGeometry args={[0.01, 0.01, 0.1, 8]} />
              </mesh>
              {item.isOn && (
                <group position={[0, height + 0.05, 0]} scale={0.7}>
                  <Flame />
                </group>
              )}
            </>
          ) : (
            <>
              <mesh material={MetalMaterial} position={[0, 0.05, 0]}>
                <cylinderGeometry args={[radius, radius, 0.1, 16]} />
              </mesh>
              <mesh material={MetalMaterial} position={[0, height/2, 0]}>
                <cylinderGeometry args={[radius*0.3, radius*0.3, height, 16]} />
              </mesh>
              {item.isOn && (
                <group position={[0, height, 0]} scale={radius / 0.15}>
                  <Flame dazzling={!!(item.visualEffect && item.visualEffect.toLowerCase().includes('dazzling'))} />
                </group>
              )}
            </>
          )}
          
          {item.contents && item.contents.length > 0 && (
             <group position={[0, height + (item.equipment.name === 'Candle' ? 0.35 : 0.4), 0]}>
                {!(item.contents.every(c => c.chemical.state === 'solid')) && (
                  <>
                    <mesh material={GlassMaterial} position={[0, 0, 0]}>
                      <cylinderGeometry args={[radius * 0.8, radius * 0.6, 0.2, 32]} />
                    </mesh>
                    <mesh material={GlassMaterial} position={[0, -0.1, 0]}>
                      <cylinderGeometry args={[radius * 0.6, radius * 0.6, 0.02, 32]} />
                    </mesh>
                  </>
                )}
                <group position={[0, -0.1, 0]}>
                   <Liquid3D shape={'cylinder'} radius={radius * 0.8} height={0.2} fillRatio={fillRatio} color={item.liquidColor || "#a0d8ef"} posX={item.position[0]} posZ={item.position[2]} />
                   <PrecipitateModel item={{...item, equipment: {...item.equipment, radius: radius*0.8, height: 0.2}}} />
                </group>
             </group>
          )}
        </group>
      )}

      {shape === 'heater' && (
        <group>
          <mesh material={PlasticMaterial} position={[0, height/2, 0]}>
            <boxGeometry args={[radius*2, height, radius*2]} />
          </mesh>
          <mesh material={DarkPlasticMaterial} position={[0, height + 0.01, 0]}>
            <cylinderGeometry args={[radius*0.8, radius*0.8, 0.02, 32]} />
          </mesh>
          <mesh material={new THREE.MeshStandardMaterial({color: item.isOn ? 0xff0000 : 0x222222, emissive: item.isOn ? 0xff0000 : 0x000000})} position={[radius*0.6, height/2, radius + 0.01]}>
             <boxGeometry args={[0.05, 0.05, 0.01]} />
          </mesh>
        </group>
      )}
      
      {shape === 'stirrer' && (
        <group>
          <mesh material={PlasticMaterial} position={[0, height/2, 0]}>
            <boxGeometry args={[radius*2, height, radius*2]} />
          </mesh>
          <mesh material={MetalMaterial} position={[0, height + 0.01, 0]}>
            <cylinderGeometry args={[radius*0.8, radius*0.8, 0.02, 32]} />
          </mesh>
        </group>
      )}

      {/* 3. Meters */}
      {(shape === 'meter_temp' || shape === 'meter_ph' || shape === 'meter_cond') && (
        <group>
          <mesh material={PlasticMaterial} position={[0, height, 0]}>
            <boxGeometry args={[radius*2, 0.2, radius*2]} />
          </mesh>
          <mesh material={MetalMaterial} position={[0, height/2, 0]}>
            <cylinderGeometry args={[radius*0.2, radius*0.2, height, 16]} />
          </mesh>
          <mesh material={ScreenMaterial} position={[0, height, radius + 0.01]}>
            <planeGeometry args={[radius*1.5, 0.1]} />
          </mesh>
          <Text position={[0, height, radius + 0.02]} fontSize={0.4} color="black" outlineWidth={0.01} outlineColor="white">
            {readingText}
          </Text>
        </group>
      )}

      {shape === 'balance' && (
        <group>
          <mesh material={PlasticMaterial} position={[0, height/2, 0]}>
            <boxGeometry args={[radius*2, height, radius*2]} />
          </mesh>
          <mesh material={MetalMaterial} position={[0, height + 0.02, 0]}>
            <cylinderGeometry args={[radius*0.8, radius*0.8, 0.04, 32]} />
          </mesh>
          <mesh material={ScreenMaterial} position={[0, height/2, radius + 0.01]}>
             <planeGeometry args={[0.4, 0.1]} />
          </mesh>
          <Text position={[0, height/2, radius + 0.02]} fontSize={0.45} color="black" outlineWidth={0.01} outlineColor="white">
            {readingText}
          </Text>
        </group>
      )}

      {/* 4. Pipettes and Thin Glassware */}
      {shape === 'pipette' && (
        <group>
          <mesh material={GlassMaterial} position={[0, height/2, 0]}>
            <cylinderGeometry args={[radius, radius, height, 16]} />
          </mesh>
          {item.equipment.name.includes('Bulb') || item.equipment.name.includes('Volumetric') ? (
            <mesh material={GlassMaterial} position={[0, height/2, 0]}>
              <sphereGeometry args={[radius*3, 16, 16]} />
            </mesh>
          ) : null}
          <Liquid3D shape={shape} radius={radius} height={height} fillRatio={fillRatio} color={item.liquidColor || "#a0d8ef"} posX={item.position[0]} posZ={item.position[2]} />
        </group>
      )}

      {/* 5. Mortar and Pestle */}
      {shape === 'mortar' && (
        <group>
          <mesh material={PlasticMaterial} position={[0, height/2, 0]}>
            <cylinderGeometry args={[radius, radius*0.6, height, 32]} />
          </mesh>
          <mesh material={DarkPlasticMaterial} position={[0, height, 0]}>
            <cylinderGeometry args={[radius*0.9, radius*0.5, 0.05, 32]} />
          </mesh>
        </group>
      )}
      
      {shape === 'pestle' && (
        <group rotation={[0, 0, 0.2]}>
          <mesh material={PlasticMaterial} position={[0, height/2, 0]}>
            <cylinderGeometry args={[radius*0.8, radius, height, 16]} />
          </mesh>
          <mesh material={PlasticMaterial} position={[0, 0, 0]}>
            <sphereGeometry args={[radius, 16, 16]} />
          </mesh>
        </group>
      )}

      {/* 6. Boxes / Complex */}
      {shape === 'box' && (
        <group>
          <mesh material={PlasticMaterial} position={[0, height/2, 0]}>
             <boxGeometry args={[radius*2, height, radius*2]} />
          </mesh>
          {item.equipment.name === 'Microscope' && (
             <mesh material={MetalMaterial} position={[0, height*1.5, 0]} rotation={[0, 0, 0.5]}>
               <cylinderGeometry args={[0.05, 0.05, height, 16]} />
             </mesh>
          )}
          {readingText && (
             <>
               <mesh material={ScreenMaterial} position={[0, height/2, radius + 0.01]}>
                  <planeGeometry args={[0.8, 0.2]} />
               </mesh>
               <Text position={[0, height/2, radius + 0.02]} fontSize={0.4} color="black" outlineWidth={0.01} outlineColor="white">
                 {readingText}
               </Text>
             </>
          )}
        </group>
      )}

      
      {shape === 'sunlight' && (
        <group>
          <mesh material={PlasticMaterial} position={[0, height - 0.1, 0]}>
            <cylinderGeometry args={[radius, radius, 0.2, 32]} />
          </mesh>
          <mesh material={new THREE.MeshBasicMaterial({ color: 0xffffaa, transparent: true, opacity: item.isOn ? 0.8 : 0.2 })} position={[0, height/2 - 0.1, 0]}>
            <cylinderGeometry args={[radius*0.8, radius*0.8, height - 0.2, 32]} />
          </mesh>
          {item.isOn && (
            <pointLight position={[0, 0, 0]} intensity={2} color="#ffffaa" distance={5} />
          )}
        </group>
      )}
      
      
      {shape === 'cooler' && (
        <group>
          <mesh material={new THREE.MeshStandardMaterial({ color: 0x88ccff, transparent: true, opacity: 0.6 })} position={[0, height/2, 0]}>
            <cylinderGeometry args={[radius, radius, height, 16]} />
          </mesh>
          <mesh material={new THREE.MeshStandardMaterial({ color: 0xffffff })} position={[0, height*0.8, 0]}>
            <boxGeometry args={[radius*1.2, height*0.4, radius*1.2]} />
          </mesh>
        </group>
      )}
      {shape === 'electrodes' && (
        <group>
          <mesh material={DarkPlasticMaterial} position={[0, height - 0.1, 0]}>
            <boxGeometry args={[radius*2, 0.2, radius*1.5]} />
          </mesh>
          {/* Electrodes */}
          <mesh material={MetalMaterial} position={[-radius*0.5, height/2 - 0.1, 0]}>
            <cylinderGeometry args={[0.02, 0.02, height - 0.2, 8]} />
          </mesh>
          <mesh material={MetalMaterial} position={[radius*0.5, height/2 - 0.1, 0]}>
            <cylinderGeometry args={[0.02, 0.02, height - 0.2, 8]} />
          </mesh>
          {/* LED indicator */}
          <mesh material={new THREE.MeshBasicMaterial({ color: item.isOn ? 0x00ff00 : 0x330000 })} position={[0, height, 0]}>
            <sphereGeometry args={[0.05, 16, 16]} />
          </mesh>
        </group>
      )}
      {shape === 'tripod' && (
        <group>
          <mesh material={MetalMaterial} position={[0, height, 0]}>
            <cylinderGeometry args={[radius, radius, 0.05, 32]} />
          </mesh>
          <mesh material={MetalMaterial} position={[radius*0.8, height/2, 0]}>
             <cylinderGeometry args={[0.02, 0.02, height, 8]} />
          </mesh>
          <mesh material={MetalMaterial} position={[-radius*0.4, height/2, radius*0.7]}>
             <cylinderGeometry args={[0.02, 0.02, height, 8]} />
          </mesh>
          <mesh material={MetalMaterial} position={[-radius*0.4, height/2, -radius*0.7]}>
             <cylinderGeometry args={[0.02, 0.02, height, 8]} />
          </mesh>
        </group>
      )}

      <PrecipitateModel item={item} />
      
      <Text position={[0, -0.2, 0]} fontSize={0.18} color="black" anchorY="top">
        {item.equipment.name}
      </Text>

      {(item.equation || item.visualEffect) && (
        <Html
          position={[0, height + 0.45, 0]}
          center
          zIndexRange={[200, 100]}
          style={{ pointerEvents: 'none' }}
          occlude={false}
        >
          <div
            className="pointer-events-none select-none"
            style={{
              maxWidth: 'min(380px, 46vw)',
              width: 'max-content',
              transform: 'translateY(-100%)',
              zIndex: 200,
            }}
          >
            <div
              className="bg-white/95 border border-indigo-200 rounded-lg shadow-md px-2.5 py-1.5 text-center"
              style={{ backdropFilter: 'blur(4px)' }}
            >
              {item.equation && (
                <div
                  className="text-indigo-800 font-semibold leading-snug break-words"
                  style={{
                    fontSize: 'clamp(16px, 1.25vw, 24px)',
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                  }}
                >
                  {item.equation}
                </div>
              )}
              {item.visualEffect && (
                <div
                  className="text-orange-600 leading-snug break-words"
                  style={{
                    fontSize: 'clamp(13px, 1vw, 18px)',
                    marginTop: item.equation ? '2px' : 0,
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    maxHeight: '2.4em',
                    overflow: 'hidden',
                  }}
                >
                  {item.visualEffect}
                </div>
              )}
            </div>
          </div>
        </Html>
      )}

      {item.gasProduced && (
        <group position={[0, height, 0]}>
           <GasEffect color={item.gasColor || '#ffffff'} />
        </group>
      )}
    </group>
  );
};
const EquipmentWrapper = ({ 
  item, 
  isActive, 
  mode, 
  onSelect, 
  onClick, 
  onUpdate,
  allItems
}: { 
  item: DeskItem, 
  isActive: boolean, 
  mode: 'translate' | 'rotate',
  onSelect: () => void,
  onClick: () => void,
  onUpdate: (pos: [number, number, number], rot: [number, number, number]) => void,
  allItems: DeskItem[]
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const initialPos = useRef(new THREE.Vector3());
  
  return (
    <group 
        ref={(g) => { 
           groupRef.current = g as THREE.Group; 
           if (typeof window !== 'undefined' && (window as any).__itemRefs) {
              (window as any).__itemRefs[item.id] = g;
           }
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onSelect();
          if (typeof window !== 'undefined' && (window as any).__setDraggedItem) { 
            (window as any).__setDraggedItem(item.id);
          }
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          if (typeof window !== 'undefined' && (window as any).__setDraggedItem) { 
            (window as any).__setDraggedItem(null);
            if (groupRef.current) {
              onUpdate([groupRef.current.position.x, groupRef.current.position.y, groupRef.current.position.z], [groupRef.current.rotation.x, groupRef.current.rotation.y, groupRef.current.rotation.z]);
            }
          }
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        position={item.position}
        rotation={item.rotation || [0,0,0]}

      >
        <Suspense fallback={null}><EquipmentModel item={item} allItems={allItems} /></Suspense>
      </group>
  );
}

export default function LabScene({ 
  deskItems, 
  onEquipmentClick, 
  onEquipmentMove,
  activeItemId,
  setActiveItemId,
  transformMode
}: { 
  deskItems: DeskItem[], 
  onEquipmentClick: (item: DeskItem) => void, 
  onEquipmentMove: (id: string, pos: [number, number, number], rot: [number, number, number]) => void,
  activeItemId: string | null,
  setActiveItemId: (id: string | null) => void,
  transformMode: 'translate' | 'rotate'
}) {
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const itemRefs = useRef<Record<string, THREE.Group>>({});
  
  React.useEffect(() => {
    const handleUp = () => setDraggedItem(null);
    window.addEventListener('pointerup', handleUp);
    return () => window.removeEventListener('pointerup', handleUp);
  }, []);
  
  // Expose to window for the wrapper
  if (typeof window !== 'undefined') {
     (window as any).__setDraggedItem = setDraggedItem;
     (window as any).__itemRefs = itemRefs.current;
  }

  return (
    <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", touchAction: "none" }} className="select-none">
      <Canvas gl={{ localClippingEnabled: true }} camera={{ position: [0, 4, 8], fov: 50 }} shadows onPointerMissed={() => { setActiveItemId(null); setDraggedItem(null); }}>
        <mesh 
          rotation={[-Math.PI / 2, 0, 0]} 
          position={[0, 0, 0]} 
          visible={false}
          onPointerMove={(e) => {
            if (draggedItem) {
               const group = itemRefs.current[draggedItem];
               if (group) {
                   const newPos = new THREE.Vector3(e.point.x, 0, e.point.z);
                   let targetY = 0;
                   for (const other of deskItems) {
                       if (other.id !== draggedItem && ['tripod', 'heater', 'stirrer', 'balance', 'box', 'burner', 'cooler'].includes(other.equipment.shape)) {
                           const dist = Math.hypot(other.position[0] - newPos.x, other.position[2] - newPos.z);
                           if (dist < other.equipment.radius) {
                               targetY = other.equipment.height;
                           }
                       }
                   }
                   newPos.y = targetY;
                   group.position.copy(newPos);
               }
            }
          }}
          onPointerUp={(e) => {
            if (draggedItem) {
               const group = itemRefs.current[draggedItem];
               if (group) {
                  onEquipmentMove(draggedItem, [group.position.x, group.position.y, group.position.z], [group.rotation.x, group.rotation.y, group.rotation.z]);
               }
               setDraggedItem(null);
            }
          }}
        >
          <planeGeometry args={[100, 100]} />
        </mesh>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 10]} castShadow intensity={1} />
        <Suspense fallback={null}><Environment preset="city" /></Suspense>
        
        <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.05} enabled={!draggedItem} enablePan={false} />

        {/* Desk Surface */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
          <planeGeometry args={[15, 15]} />
          <meshStandardMaterial color="#4a4e69" />
        </mesh>
        
        <Grid 
          position={[0, -0.04, 0]}
          args={[15, 15]}
          cellSize={0.5}
          cellThickness={1}
          cellColor="#6b7280"
          sectionSize={1.5}
          sectionThickness={1.5}
          sectionColor="#9ca3af"
          fadeDistance={25}
          fadeStrength={1}
        />

        <ContactShadows position={[0, 0, 0]} opacity={0.4} scale={20} blur={2} far={4} />

        {/* Render Equipments */}
        {deskItems.map((item) => (
          <EquipmentWrapper
            key={item.id}
            item={item}
            allItems={deskItems}
            isActive={activeItemId === item.id}
            mode={transformMode}
            onSelect={() => setActiveItemId(item.id)}
            onClick={() => onEquipmentClick(item)}
            onUpdate={(pos, rot) => onEquipmentMove(item.id, pos, rot)}
          />
        ))}
            </Canvas>
    </div>
  );
}
