export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
export const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export function normalize(v) { const d = Math.hypot(...v); return v.map(x => x/d); }
export function rotate(p, omega, dt) {
  const length = Math.hypot(...omega);
  if (!length) return [...p];
  const axis = omega.map(x => x / length), a = length * dt, c = Math.cos(a), s = Math.sin(a);
  const tangent = cross(axis, p), projection = dot(axis, p);
  return p.map((x, k) => x*c + tangent[k]*s + axis[k]*projection*(1-c));
}
export function makeGrid(width, height, radiusKm) {
  const size = width * height, positions = new Float64Array(size*3), latitude = new Float64Array(size), areaKm2 = new Float64Array(size);
  const step = Math.PI / height;
  for (let y = 0; y < height; y++) {
    const lat = Math.PI/2 - (y+0.5)*step;
    const area = radiusKm**2 * (2*Math.PI/width) * (Math.sin(Math.PI/2-y*step)-Math.sin(Math.PI/2-(y+1)*step));
    for (let x = 0; x < width; x++) {
      const i = y*width+x, lon = (x+0.5)*2*Math.PI/width-Math.PI;
      positions.set([Math.cos(lat)*Math.cos(lon), Math.sin(lat), Math.cos(lat)*Math.sin(lon)], i*3);
      latitude[i] = lat; areaKm2[i] = area;
    }
  }
  // Longitude wraps; crossing a pole reaches the opposite meridian.
  function index(x, y) {
    if (y < 0) { y = -y-1; x += width/2; }
    if (y >= height) { y = 2*height-y-1; x += width/2; }
    return y*width + ((x%width)+width)%width;
  }
  function neighbors(i) {
    const x=i%width, y=Math.floor(i/width);
    return [index(x-1,y), index(x+1,y), index(x,y-1), index(x,y+1)];
  }
  function point(i) { return [positions[i*3], positions[i*3+1], positions[i*3+2]]; }
  function sample(p) {
    const lat = Math.asin(clamp(p[1],-1,1)), lon = Math.atan2(p[2],p[0]);
    return index(Math.floor((lon+Math.PI)/(2*Math.PI)*width), clamp(Math.floor((Math.PI/2-lat)/Math.PI*height),0,height-1));
  }
  function sampleField(field,p) {
    const lat=Math.asin(clamp(p[1],-1,1)),lon=Math.atan2(p[2],p[0]);
    const fx=(lon+Math.PI)/(2*Math.PI)*width-0.5,fy=(Math.PI/2-lat)/Math.PI*height-0.5;
    const x=Math.floor(fx),y=Math.floor(fy),tx=fx-x,ty=fy-y;
    return field[index(x,y)]*(1-tx)*(1-ty)+field[index(x+1,y)]*tx*(1-ty)+field[index(x,y+1)]*(1-tx)*ty+field[index(x+1,y+1)]*tx*ty;
  }
  function distance(a,b) { return radiusKm * Math.acos(clamp(dot(point(a),point(b)),-1,1)); }
  return {width,height,size,radiusKm,positions,latitude,areaKm2,index,neighbors,point,sample,sampleField,distance};
}
