const FOOD_NAME = 'Paneer Tikka';

const nutritionCatalog = {
  'paneer tikka': { calories: 320, source: 'Kinetic Lab local nutrition guide' },
  'masala dosa': { calories: 387, source: 'Kinetic Lab local nutrition guide' },
  'protein oats': { calories: 420, source: 'Kinetic Lab local nutrition guide' },
  'salmon power bowl': { calories: 580, source: 'Kinetic Lab local nutrition guide' },
  'chicken biryani': { calories: 480, source: 'Kinetic Lab local nutrition guide' },
  'idli': { calories: 58, source: 'Kinetic Lab local nutrition guide' },
  'banana': { calories: 105, source: 'Kinetic Lab local nutrition guide' },
  'rice': { calories: 205, source: 'Kinetic Lab local nutrition guide' },
  'roti': { calories: 120, source: 'Kinetic Lab local nutrition guide' }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const state = { stream: null, poseLandmarker: null, poseLoop: 0, modelLoading: false, lastPoseAt: 0 };

function showView(viewName) {
  $$('.view').forEach((view) => {
    const isActive = view.id === `view-${viewName}`;
    view.classList.toggle('is-visible', isActive);
    view.hidden = !isActive;
  });
  $$('.nav-item').forEach((button) => button.classList.toggle('is-active', button.dataset.view === viewName));
  history.replaceState(null, '', `#${viewName}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('[data-view]').forEach((control) => control.addEventListener('click', () => showView(control.dataset.view)));

$('#theme-toggle').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  $('#theme-toggle').textContent = document.body.classList.contains('dark') ? 'Light mode' : 'Dark mode';
});

$('#log-glass').addEventListener('click', () => {
  const count = Math.min(8, Number($('#hydration-count').textContent) + 1);
  $('#hydration-count').textContent = count;
  $('#water-fill').style.width = `${Math.round((count / 8) * 100)}%`;
  $('#log-glass').textContent = count === 8 ? 'Target reached' : 'Log glass';
});

$('#complete-session').addEventListener('click', (event) => {
  event.currentTarget.textContent = 'Session complete';
  event.currentTarget.disabled = true;
});

async function fetchCalories(food) {
  const key = food.trim().toLowerCase();
  if (!key) return { calories: null, source: 'Enter a food name' };
  if (nutritionCatalog[key]) return nutritionCatalog[key];

  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?action=process&json=1&page_size=1&fields=product_name,nutriments&search_terms=${encodeURIComponent(food)}`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Public lookup unavailable');
    const data = await response.json();
    const product = data.products?.[0];
    const calories = product?.nutriments?.['energy-kcal_100g'] ?? product?.nutriments?.['energy-kcal'];
    if (Number.isFinite(Number(calories))) return { calories: Number(calories), source: 'Open Food Facts, per 100 g' };
  } catch (error) {
    console.info('Public food lookup unavailable:', error.message);
  }

  return { calories: 250, source: 'Demo estimate, update with a verified label' };
}

function computeWeeklySuggestion(caloriesPerServing, dailyBudget, servingSize) {
  if (!caloriesPerServing || caloriesPerServing <= 0 || !dailyBudget || dailyBudget <= 0 || !servingSize || servingSize <= 0) {
    return 'Add a valid food, calorie budget, and serving size to see a suggestion.';
  }
  const weeklyAllowance = dailyBudget * 7 * 0.15;
  const servings = Math.max(1, Math.floor(weeklyAllowance / (caloriesPerServing * servingSize)));
  const totalCalories = Math.round(servings * caloriesPerServing * servingSize);
  return `With a ${dailyBudget.toLocaleString()} kcal budget, ${servings} serving${servings === 1 ? '' : 's'} fits this week at about ${totalCalories.toLocaleString()} kcal total.`;
}

async function recalculateNutrition() {
  const button = $('#recalc');
  const food = $('#food-name').value || FOOD_NAME;
  const budget = Number($('#daily-budget').value);
  const servingSize = Number($('#serving-size').value);
  button.disabled = true;
  button.firstChild.textContent = 'Looking up... ';
  const result = await fetchCalories(food);
  $('#calorie-value').textContent = result.calories == null ? 'Not found' : `${Math.round(result.calories * servingSize)} kcal`;
  $('#source-name').textContent = result.source;
  $('#weekly-suggestion').textContent = computeWeeklySuggestion(result.calories, budget, servingSize);
  button.disabled = false;
  button.firstChild.textContent = 'Calculate calories ';
}

$('#recalc').addEventListener('click', recalculateNutrition);
$('#food-name').addEventListener('keydown', (event) => { if (event.key === 'Enter') recalculateNutrition(); });

function setCameraStatus(message) { $('#camera-status').textContent = message; }

function setCue(id, status, message) {
  const cue = $(`#cue-${id}`);
  cue.classList.remove('is-good', 'is-warn', 'is-muted');
  cue.classList.add(status === 'good' ? 'is-good' : status === 'warn' ? 'is-warn' : 'is-muted');
  cue.querySelector('p').textContent = message;
}

function updatePostureFeedback(landmarks) {
  const points = { nose: landmarks[0], leftShoulder: landmarks[11], rightShoulder: landmarks[12], leftHip: landmarks[23], rightHip: landmarks[24] };
  if (Object.values(points).some((point) => !point || (point.visibility ?? 1) < .35)) return;
  const shoulderMid = { x: (points.leftShoulder.x + points.rightShoulder.x) / 2, y: (points.leftShoulder.y + points.rightShoulder.y) / 2 };
  const hipMid = { x: (points.leftHip.x + points.rightHip.x) / 2, y: (points.leftHip.y + points.rightHip.y) / 2 };
  const headTilt = Math.abs(points.nose.x - shoulderMid.x);
  const shoulderTilt = Math.abs(points.leftShoulder.y - points.rightShoulder.y);
  const spineLean = Math.abs(shoulderMid.x - hipMid.x);
  const headGood = headTilt < .08;
  const shouldersGood = shoulderTilt < .06;
  const spineGood = spineLean < .12;
  setCue('head', headGood ? 'good' : 'warn', headGood ? 'Centered over your shoulders' : 'Bring your head gently back to center');
  setCue('shoulders', shouldersGood ? 'good' : 'warn', shouldersGood ? 'Shoulders look level' : 'Relax and level your shoulders');
  setCue('spine', spineGood ? 'good' : 'warn', spineGood ? 'Spine is stacked over hips' : 'Stack your ribs over your pelvis');
  const score = Math.round(((headGood ? 1 : .58) + (shouldersGood ? 1 : .66) + (spineGood ? 1 : .62)) / 3 * 100);
  $('#posture-score').textContent = score;
  $('#posture-score-state').textContent = score > 84 ? 'Optimal' : score > 68 ? 'Adjust' : 'Reset';
  $('#posture-summary').textContent = score > 84 ? 'Great stack. Keep breathing and stay relaxed.' : 'Use the live cues to make one small adjustment at a time.';
}

function drawLandmarks(result) {
  const canvas = $('#posture-canvas');
  const video = $('#posture-video');
  const context = canvas.getContext('2d');
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 400;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  context.clearRect(0, 0, width, height);
  const landmarks = result.landmarks?.[0];
  if (!landmarks) return;
  const keyIndexes = [0, 11, 12, 23, 24];
  context.fillStyle = '#b8e45f';
  keyIndexes.forEach((index) => { const point = landmarks[index]; if (point) { context.beginPath(); context.arc(point.x * width, point.y * height, 7, 0, Math.PI * 2); context.fill(); } });
  updatePostureFeedback(landmarks);
}

async function loadPoseModel() {
  if (state.poseLandmarker || state.modelLoading) return state.poseLandmarker;
  state.modelLoading = true;
  try {
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm');
    const fileset = await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm');
    state.poseLandmarker = await vision.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', delegate: 'GPU' }, runningMode: 'VIDEO', numPoses: 1 });
    return state.poseLandmarker;
  } catch (error) {
    console.info('Pose model unavailable:', error.message);
    return null;
  } finally { state.modelLoading = false; }
}

async function runPoseLoop() {
  if (!state.stream) return;
  const video = $('#posture-video');
  if (state.poseLandmarker && video.readyState >= 2 && performance.now() - state.lastPoseAt > 80) {
    state.lastPoseAt = performance.now();
    const result = state.poseLandmarker.detectForVideo(video, performance.now());
    drawLandmarks(result);
  }
  state.poseLoop = requestAnimationFrame(runPoseLoop);
}

async function startCamera() {
  const errorEl = $('#camera-error');
  errorEl.hidden = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs a secure context. Open this project on localhost or HTTPS.');
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    $('#posture-video').srcObject = state.stream;
    $('#camera-placeholder').style.display = 'none';
    $('#start-camera').disabled = true;
    $('#stop-camera').disabled = false;
    setCameraStatus('Camera live');
    setCue('head', 'muted', 'Loading pose model'); setCue('shoulders', 'muted', 'Loading pose model'); setCue('spine', 'muted', 'Loading pose model');
    const model = await loadPoseModel();
    if (!model) { setCameraStatus('Camera live / guide mode'); $('#posture-summary').textContent = 'Camera is active. The pose model could not load, so use the alignment guides manually.'; }
    runPoseLoop();
  } catch (error) {
    errorEl.textContent = error.name === 'NotAllowedError' ? 'Camera permission was not granted. Allow access in your browser and try again.' : error.message;
    errorEl.hidden = false;
    setCameraStatus('Camera off');
  }
}

function stopCamera() {
  if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
  state.stream = null;
  cancelAnimationFrame(state.poseLoop);
  $('#posture-video').srcObject = null;
  $('#posture-canvas').getContext('2d').clearRect(0, 0, $('#posture-canvas').width, $('#posture-canvas').height);
  $('#camera-placeholder').style.display = 'grid';
  $('#start-camera').disabled = false;
  $('#stop-camera').disabled = true;
  setCameraStatus('Camera off');
}

$('#start-camera').addEventListener('click', startCamera);
$('#stop-camera').addEventListener('click', stopCamera);
window.addEventListener('beforeunload', stopCamera);

const initialView = window.location.hash.slice(1);
if (['overview', 'posture', 'fuel', 'challenges', 'progress', 'personalize'].includes(initialView)) showView(initialView);

$('#join-challenge').addEventListener('click', (event) => { event.currentTarget.textContent = 'Challenge joined'; event.currentTarget.disabled = true; });
$('#save-preferences').addEventListener('click', (event) => { event.currentTarget.textContent = 'Preferences saved'; event.currentTarget.disabled = true; });
