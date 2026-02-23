import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import './style.css'

// -----------------------------------
// ESCENA
// -----------------------------------

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xbfc4c7)
scene.fog = new THREE.Fog(0xbfc4c7, 200, 900)

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  5000
)

camera.position.set(0, 2, 20)

const renderer = new THREE.WebGLRenderer({ antialias: false })
renderer.setPixelRatio(1)
renderer.setSize(window.innerWidth * 0.8, window.innerHeight * 0.8)
renderer.domElement.style.width = "100%"
renderer.domElement.style.height = "100%"
document.body.appendChild(renderer.domElement)

renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 2.0

// -----------------------------------
// AUDIO
// -----------------------------------

const listener = new THREE.AudioListener()
camera.add(listener)

const audioLoader = new THREE.AudioLoader()

const startupSound = new THREE.Audio(listener)
const motorSound = new THREE.Audio(listener)

let engineStarted = false
let motorVolume = 0

function unlockAudio() {
  const context = listener.context
  if (context.state === 'suspended') {
    context.resume()
  }
}

audioLoader.load('/sounds/ENCENDIDO.wav', (buffer) => {
  startupSound.setBuffer(buffer)
  startupSound.setVolume(0.05)
})

audioLoader.load('/sounds/RUIDO.wav', (buffer) => {
  motorSound.setBuffer(buffer)
  motorSound.setLoop(true)
  motorSound.setVolume(0)
})

function startDroneEngine() {
  if (engineStarted) return
  engineStarted = true

  unlockAudio()

  startupSound.play()

  setTimeout(() => {
    motorSound.play()
  }, 1500)
}

// -----------------------------------
// POSTPROCESS
// -----------------------------------

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))

let nightVisionOn = false

const DroneShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    fade: { value: 0 },
    night: { value: 0 },
    flash: { value: 1 }
  },

  vertexShader: `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
    }
  `,

fragmentShader: `
uniform sampler2D tDiffuse;
uniform float time;
uniform float fade;
uniform float night;
uniform float flash;
varying vec2 vUv;

float random(vec2 uv){
  return fract(sin(dot(uv.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

void main(){

  vec2 uv = vUv;
  // --- Rolling shutter leve ---
float rollStrength = 0.0005;   // MUY bajo
float rollSpeed = 2.0;

uv.x += sin(uv.y * 8.0 + time * rollSpeed) * rollStrength;

  // Imagen base normal (SIN pixelado duro)
  vec4 base = texture2D(tDiffuse, uv);

  // Blur óptico leve tipo cámara DV
  vec4 blur =
    texture2D(tDiffuse, uv + vec2(0.0015, 0.0)) +
    texture2D(tDiffuse, uv - vec2(0.0015, 0.0)) +
    texture2D(tDiffuse, uv + vec2(0.0, 0.0015)) +
    texture2D(tDiffuse, uv - vec2(0.0, 0.0015));

  blur *= 0.25;

  vec4 color = mix(base, blur, 0.25);

  if(night > 0.5){

    float gray = dot(color.rgb, vec3(0.299,0.587,0.114));
    vec3 green = vec3(0.45,1.0,0.5) * gray * 2.5;

    float noise = random(uv + time * 0.5) * 0.05;
    green += noise;

    color.rgb = green;

  } else {

    // Gamma ligeramente plana
    color.rgb = pow(color.rgb, vec3(1.1));

    // Saturación reducida leve
    float gray = dot(color.rgb, vec3(0.3,0.59,0.11));
    color.rgb = mix(color.rgb, vec3(gray), 0.1);

    // Banding MUY leve (no pixel)
    color.rgb = floor(color.rgb * 128.0) / 128.0;

    // Ruido fino tipo CCD
    float noise = random(uv + time * 0.4) * 0.015;
    color.rgb += noise;

    // Elevación suave de negros
    color.rgb = mix(color.rgb, vec3(0.05), 0.05);

    // Scanlines casi invisibles
    float scan = sin(uv.y * 800.0) * 0.008;
    color.rgb -= scan;
  }

  color.rgb += flash;
  color.rgb *= fade;

  gl_FragColor = vec4(color.rgb, 1.0);
}
`
}

const dronePass = new ShaderPass(DroneShader)
composer.addPass(dronePass)

// -----------------------------------
// LUCES
// -----------------------------------

const ambient = new THREE.AmbientLight(0xffffff, 1.6)
scene.add(ambient)

const sun = new THREE.DirectionalLight(0xffffff, 20)
sun.position.set(200, 300, 200)
scene.add(sun)

// -----------------------------------
// MAPA
// -----------------------------------

const loader = new GLTFLoader()
let map
let mapBounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }

loader.load('/models/map.glb', (gltf) => {

  map = gltf.scene
  const box = new THREE.Box3().setFromObject(map)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())

  map.position.sub(center)
  const scaleFactor = 200 / Math.max(size.x, size.y, size.z)
  map.scale.setScalar(scaleFactor)

  scene.add(map)

  const scaledBox = new THREE.Box3().setFromObject(map)
  mapBounds.minX = scaledBox.min.x
  mapBounds.maxX = scaledBox.max.x
  mapBounds.minZ = scaledBox.min.z
  mapBounds.maxZ = scaledBox.max.z
})

// -----------------------------------
// CAMISETA
// -----------------------------------

let camiseta
let interactionDistance = 8
let overlayOpen = false
let shirtFloatTime = 0 

loader.load('/models/camisetaraimon.glb', (gltf) => {

  camiseta = gltf.scene
  camiseta.position.set(0, 4, 0) // centro del mapa
  camiseta.scale.setScalar(4)

  scene.add(camiseta)
})

// -----------------------------------
// DRONE OVERLAY
// -----------------------------------

let droneOverlay

loader.load('/models/drone.glb', (gltf) => {
  droneOverlay = gltf.scene
  droneOverlay.scale.setScalar(6)
  droneOverlay.position.set(0.4, -0.8, 0.4)
  droneOverlay.rotation.y = Math.PI / 2

  droneOverlay.traverse((child) => {
  if (child.isMesh && child.material) {

    // Si el material es estándar (PBR)
    if (child.material.isMeshStandardMaterial) {

      child.material.metalness = 1       // 0 = plástico, 1 = metal
      child.material.roughness = 0.45      // 0 = espejo, 1 = mate
      child.material.envMapIntensity = 0.5
      child.material.needsUpdate = true
    }

  }
})

  camera.add(droneOverlay)
  scene.add(camera)
})

// -----------------------------------
// MOVIMIENTO
// -----------------------------------

const keys = {}

window.addEventListener('keydown', e => {

  const key = e.key.toLowerCase()
  keys[key] = true

  const validKeys = ['w','a','s','d',' ','shift']

  if(!engineStarted && validKeys.includes(key)){

    engineStarted = true

    // AUDIO
    const ctx = listener.context
    if(ctx.state === 'suspended'){
      ctx.resume()
    }

    startupSound.play()
    motorSound.setVolume(0)
    motorSound.play()
    motorVolume = 0

    // FADE OUT PANTALLA
    const startScreen = document.getElementById('startScreen')

  if(startScreen){
  startScreen.style.transition = "opacity 0.8s ease"
  startScreen.style.opacity = "0"

  setTimeout(()=>{
    startScreen.style.display = "none"
  }, 800)
}
  }
})

window.addEventListener('keyup', e => {
  keys[e.key.toLowerCase()] = false
})

let velocity = new THREE.Vector3()
const acceleration = 0.08
const friction = 0.92
const maxSpeed = 1.6
const rotationSpeed = 0.05

let floatTime = 0
let fadeValue = 0
let flashValue = 1.5

function animate(){

  requestAnimationFrame(animate)

  shirtFloatTime += 0.02

if (camiseta) {
  camiseta.position.y = 4 + Math.sin(shirtFloatTime) * 0.18
}

  floatTime += 0.03

  if(flashValue > 0) flashValue -= 0.1
  if(fadeValue < 1) fadeValue += 0.12

  dronePass.uniforms.flash.value = flashValue
  dronePass.uniforms.fade.value = fadeValue

  if(keys['a']) camera.rotation.y += rotationSpeed
  if(keys['d']) camera.rotation.y -= rotationSpeed

  const forward = new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion)

  if(keys['w']) velocity.add(forward.clone().multiplyScalar(acceleration))
  if(keys['s']) velocity.add(forward.clone().multiplyScalar(-acceleration))

  velocity.multiplyScalar(friction)
  if(velocity.length() > maxSpeed) velocity.setLength(maxSpeed)

  camera.position.add(velocity)

  if(keys[' ']) camera.position.y += 0.6
  if(keys['shift']) camera.position.y -= 0.6
  if(camera.position.y < 2) camera.position.y = 2

  camera.position.x = THREE.MathUtils.clamp(camera.position.x, mapBounds.minX, mapBounds.maxX)
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, mapBounds.minZ, mapBounds.maxZ)

  if(engineStarted && motorSound.isPlaying){
    if(motorVolume < 0.05){
      motorVolume += 0.003
      motorSound.setVolume(motorVolume)
    }
  }

  dronePass.uniforms.time.value += 0.02
  // ✨ Flotación sutil
if(droneOverlay){
  droneOverlay.position.y = -0.8 + Math.sin(floatTime) * 0.01
  droneOverlay.rotation.z = Math.sin(floatTime) * 0.002
}

if(camiseta){

  const distance = camera.position.distanceTo(camiseta.position)
  const interactionText = document.getElementById('interactionText')
  const overlay = document.getElementById('productOverlay')

  // Mostrar texto solo si está cerrado
  if(distance < interactionDistance && !overlayOpen){
    interactionText.classList.remove('hidden')
  } else {
    interactionText.classList.add('hidden')
  }

  // 🔥 Cerrar overlay automáticamente si te alejas
  if(overlayOpen && distance > interactionDistance + 10){
    overlay.classList.add('hidden')
    overlayOpen = false
  }


  if(distance < interactionDistance){
    interactionText.classList.remove('hidden')
  } else {
    interactionText.classList.add('hidden')
  }
}
  composer.render()
}

animate()

window.addEventListener('keydown', e => {

  const key = e.key.toLowerCase()
  keys[key] = true

  // 🚀 SOLO ESPACIO INICIA DRON
  if(key === ' '){

    const startScreen = document.getElementById('startScreen')

    if(startScreen){
      startScreen.style.opacity = "0"
      setTimeout(()=> startScreen.remove(), 800)
    }

    if(!engineStarted){

      engineStarted = true

      const ctx = listener.context
      if(ctx.state === 'suspended'){
        ctx.resume()
      }

      startupSound.play()
      motorSound.setVolume(0)
      motorSound.play()
      motorVolume = 0
    }
  }

  // 🌙 NIGHT VISION CON Q
  if(key === 'q'){

    nightVisionOn = !nightVisionOn
    dronePass.uniforms.night.value = nightVisionOn ? 1 : 0

    if(nightVisionOn){
      ambient.intensity = 0.6
      sun.intensity = 3
      scene.background = new THREE.Color(0x0a0f0a)
      scene.fog.color.set(0x0a0f0a)
    } else {
      ambient.intensity = 1.6
      sun.intensity = 20
      scene.background = new THREE.Color(0xbfc4c7)
      scene.fog.color.set(0xbfc4c7)
    }
  }
// 🧥 INTERACTUAR CON CAMISETA
  if(key === 'e' && camiseta){

  const overlay = document.getElementById('productOverlay')
  const distance = camera.position.distanceTo(camiseta.position)

  // Si está abierto → cerrar
  if(overlayOpen){
    overlay.classList.add('hidden')
    overlayOpen = false
    return
  }

  // Si está cerrado → abrir solo si estás cerca
  if(distance < interactionDistance){
    overlay.classList.remove('hidden')
    overlayOpen = true
  }
}


})

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth * 0.8, window.innerHeight * 0.8)
})

let isFront = true

document.getElementById('flipButton').addEventListener('click', () => {

  const image = document.getElementById('productImage')

  if(isFront){
    image.src = "/images/imagen2.png"
  } else {
    image.src = "/images/imagen1.png"
  }

  isFront = !isFront
})