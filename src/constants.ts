// Changing this will mean new seed data for everything
export const APIVersion = "1"

// Are you working in a dev build?
export const isInDevMode = document.location.port === "8085"

/** All methods of getting the window height in JS exclude the iPhone notch.
 * The best way we have to calculate notch height is to add a fake element,
 * and then grab the calculated safe area insets off of.
 * [insert sounds of exasperation] */
export let NotchOffset = 0
if (CSS.supports('padding-top: env(safe-area-inset-top)')) {
    let div = document.createElement('div');
    div.style.paddingTop = 'env(safe-area-inset-top)';
    document.body.appendChild(div);
    let calculatedPadding = parseInt(window.getComputedStyle(div).paddingTop, 10);
    document.body.removeChild(div);
    NotchOffset = calculatedPadding / window.devicePixelRatio
}

export const GameWidth = 160
export const GameHeight = screen.height / window.devicePixelRatio + NotchOffset

// The HTML canvas is as tall as the device, but the playable vertical area is fixed
export const GameAreaHeight = 240

// To center the game canvas
export const GameAreaTopOffset = (GameHeight - GameAreaHeight) / 2

// Battle Constants

/// Mysterious multiplier for the original game values from Zach
export const mapValue = 20
export const flapStrength = 6.8 * this.mapValue
export const gravity = 23 * this.mapValue
export const pipeSpeed = 2.9 * this.mapValue
export const timeBeforeFirstPipeLoads = 1800
export const pipeRepeatTime = 1300
export const gapHeight = 56
export const birdXPosition = -8
export const birdYPosition = 38
export const timeBetweenYSyncs = 400

export enum zLevels {
    ui = 8,
    ground = 7,
    pipe = 6,
    debugText = 5,
    birdWings = 12,
    birdAttire = 4,
    playerBird = 3,
    focusBackdrop = 2
}
