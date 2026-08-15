import React, { useRef } from 'react';
import { DragControls } from '@react-three/drei';
import * as THREE from 'three';

export default function Test() {
  const ref = useRef<THREE.Group>(null);
  return (
    <DragControls ref={ref} axisLock="z" onDragEnd={() => console.log(ref.current?.position)}>
      <mesh />
    </DragControls>
  )
}
