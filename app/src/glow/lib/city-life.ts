// The life of the night city's streets: moving traffic (green waves on the avenues, queues at the lights on the
// crosstown streets, head- and taillights, taxis), parked cars, traffic signals cycling, shopfronts with their
// signs, awnings and neon, street trees, hydrants and the rest, steam from the manholes, the elevated line with
// its trains, the highway overpass along the river.
import * as THREE from 'three';
import type { City, CityOpts } from './city';

export class CityLife extends THREE.Group {
  /** objects that are not drawn into the wet-street reflection */
  mirrorHide: THREE.Object3D[] = [];
  constructor(private city: City, _o: CityOpts) {
    super();
  }
  flash(k: number, seed: number) { this.city.U.uFlash.value.set(k, seed); }
  update(_t: number, _cam: THREE.Vector3) {}
}
