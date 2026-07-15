// ============================================================
// quantumE91.js - E91 Protocol Quantum Key Distribution Simulation
// Quantum Secure Chat Application
// ============================================================
// 
// THE E91 PROTOCOL (Artur Ekert, 1991):
// - Uses quantum entanglement between particle pairs (EPR pairs)
// - Alice and Bob each randomly choose measurement bases
// - Correlated measurement results form the shared secret key
// - Security guaranteed by Bell's inequality violations
// ============================================================

/**
 * Simulate one entangled particle pair (EPR pair).
 * In a real quantum system, measuring one particle instantly
 * determines the correlated result of the other particle.
 * Here we simulate this with random correlated bit generation.
 * 
 * @returns {Object} { aliceBit, bobBit } - correlated bits
 */
function generateEntangledPair() {
  // Quantum entanglement: both particles share the same "state"
  // When Alice measures, Bob's result is perfectly correlated
  const sharedQuantumState = Math.round(Math.random()); // 0 or 1
  return {
    aliceBit: sharedQuantumState,
    bobBit: sharedQuantumState // Entangled: same state
  };
}

/**
 * Randomly select a measurement basis for each particle.
 * E91 Protocol uses three measurement angles:
 *   Basis 0 → 0°   (Z-basis)
 *   Basis 1 → 45°  (diagonal)
 *   Basis 2 → 90°  (X-basis)
 * 
 * @returns {number} basis index (0, 1, or 2)
 */
function randomBasis() {
  return Math.floor(Math.random() * 3); // Returns 0, 1, or 2
}

/**
 * Apply measurement basis to a bit.
 * If Alice and Bob use DIFFERENT bases, the result is unreliable
 * (quantum noise causes mismatch). If they use the SAME basis,
 * the correlated quantum state is preserved in measurement.
 * 
 * @param {number} bit - the original correlated bit (0 or 1)
 * @param {number} aliceBasis - Alice's chosen basis
 * @param {number} bobBasis - Bob's chosen basis
 * @returns {Object} { aliceMeasured, bobMeasured }
 */
function applyMeasurement(bit, aliceBasis, bobBasis) {
  if (aliceBasis === bobBasis) {
    // Same basis → measurements are perfectly correlated
    return { aliceMeasured: bit, bobMeasured: bit };
  } else {
    // Different basis → results are independent (random noise)
    return {
      aliceMeasured: Math.round(Math.random()),
      bobMeasured: Math.round(Math.random())
    };
  }
}

/**
 * MAIN FUNCTION: Run the full E91 QKD Protocol Simulation
 * 
 * Steps:
 * 1. Generate N entangled particle pairs
 * 2. Alice and Bob each randomly choose bases
 * 3. They measure their particles
 * 4. Key Sifting: Keep only bits where bases match
 * 5. The sifted key becomes the shared secret key
 * 
 * @param {number} numParticles - number of entangled pairs to simulate
 * @returns {Object} full QKD result with all intermediate steps
 */
function runE91Protocol(numParticles = 20) {
  const aliceBases = [];
  const bobBases = [];
  const aliceBits = [];
  const bobBits = [];
  const aliceMeasured = [];
  const bobMeasured = [];
  const siftedIndices = [];
  const siftedKey = [];

  // -------------------------------------------------------
  // STEP 1 & 2: Generate entangled pairs, choose bases, measure
  // -------------------------------------------------------
  for (let i = 0; i < numParticles; i++) {
    // Generate one entangled EPR pair
    const { aliceBit, bobBit } = generateEntangledPair();
    aliceBits.push(aliceBit);
    bobBits.push(bobBit);

    // Alice and Bob independently choose random bases
    const aBasis = randomBasis();
    const bBasis = randomBasis();
    aliceBases.push(aBasis);
    bobBases.push(bBasis);

    // Apply measurement based on chosen bases
    const measured = applyMeasurement(aliceBit, aBasis, bBasis);
    aliceMeasured.push(measured.aliceMeasured);
    bobMeasured.push(measured.bobMeasured);
  }

  // -------------------------------------------------------
  // STEP 3: KEY SIFTING
  // Alice and Bob publicly announce their bases (not the bits!)
  // They keep only the bits where their bases MATCHED
  // -------------------------------------------------------
  for (let i = 0; i < numParticles; i++) {
    if (aliceBases[i] === bobBases[i]) {
      siftedIndices.push(i);
      siftedKey.push(aliceMeasured[i]); // Both have same bit
    }
  }

  // -------------------------------------------------------
  // STEP 4: Final shared key from sifted bits
  // In a real system, error correction and privacy amplification
  // would be applied here. For simulation, sifted key = final key.
  // -------------------------------------------------------
  const finalKey = [...siftedKey];

  // Convert final key array to a hex string for use in encryption
  const keyHex = finalKey.join('');

  return {
    numParticles,
    aliceBases,       // Alice's random basis choices
    bobBases,         // Bob's random basis choices
    aliceBits,        // Alice's original entangled bits
    bobBits,          // Bob's original entangled bits
    aliceMeasured,    // Alice's measurement results
    bobMeasured,      // Bob's measurement results
    siftedIndices,    // Indices where bases matched
    siftedKey,        // Bits kept after sifting
    finalKey,         // The final shared secret key (array)
    keyHex,           // Key as binary string
    keyLength: finalKey.length,
    basisNames: ['0° (Z)', '45° (D)', '90° (X)']
  };
}

/**
 * XOR ENCRYPTION using the quantum key
 * 
 * The quantum key is repeated (cycled) to match message length.
 * Each character in the message is XOR-ed with the corresponding
 * key bit value (0 or 1) extended to byte level.
 * 
 * @param {string} message - plaintext message
 * @param {number[]} key - array of bits (0s and 1s)
 * @returns {string} encrypted message as hex string
 */
function encryptMessage(message, key) {
  if (!key || key.length === 0) {
    throw new Error('Quantum key is empty. Cannot encrypt.');
  }

  // Convert key bits to a byte-level key by repeating the key pattern
  // We expand each key bit to a full byte value (0x00 or 0xFF)
  // for meaningful XOR encryption at character level
  const keyBytes = [];
  for (let i = 0; i < message.length; i++) {
    // Cycle through key bits, scale to 0-255 range
    const keyBit = key[i % key.length];
    // Use key position and bit to derive a pseudo-random byte
    const keyByte = (keyBit * 127 + (i * 31 + key[(i * 3) % key.length] * 17)) % 256;
    keyBytes.push(keyByte);
  }

  // XOR each character with the corresponding key byte
  let encrypted = '';
  for (let i = 0; i < message.length; i++) {
    const charCode = message.charCodeAt(i);
    const encryptedChar = charCode ^ keyBytes[i];
    encrypted += encryptedChar.toString(16).padStart(2, '0'); // hex encoding
  }

  return encrypted;
}

/**
 * XOR DECRYPTION using the same quantum key
 * (XOR is symmetric: encrypt and decrypt use same operation)
 * 
 * @param {string} encryptedHex - encrypted message as hex string
 * @param {number[]} key - array of bits (same key used for encryption)
 * @returns {string} decrypted plaintext message
 */
function decryptMessage(encryptedHex, key) {
  if (!key || key.length === 0) {
    throw new Error('Quantum key is empty. Cannot decrypt.');
  }

  // Rebuild the same key bytes
  const keyBytes = [];
  const messageLength = encryptedHex.length / 2;
  for (let i = 0; i < messageLength; i++) {
    const keyBit = key[i % key.length];
    const keyByte = (keyBit * 127 + (i * 31 + key[(i * 3) % key.length] * 17)) % 256;
    keyBytes.push(keyByte);
  }

  // XOR each hex pair back to original character
  let decrypted = '';
  for (let i = 0; i < messageLength; i++) {
    const hexPair = encryptedHex.substr(i * 2, 2);
    const encryptedCharCode = parseInt(hexPair, 16);
    const decryptedCharCode = encryptedCharCode ^ keyBytes[i];
    decrypted += String.fromCharCode(decryptedCharCode);
  }

  return decrypted;
}

module.exports = { runE91Protocol, encryptMessage, decryptMessage };