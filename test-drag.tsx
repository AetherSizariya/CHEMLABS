import React from 'react';
import { DragControls } from '@react-three/drei';

export default function Test() {
  return (
    <DragControls axisLock="y">
      <mesh />
    </DragControls>
  )
}
