// src/config/firebase.js
// Inicializa Firebase Admin e expõe atalhos para Auth, Firestore e FieldValue

import admin from 'firebase-admin';
import logger from '../utils/logger.js';

let firebaseApp = null;

export function getFirebaseAdmin() {
  if (firebaseApp) return firebaseApp;

  const rawCredential = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!rawCredential) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT não definida. Cole o JSON da service account na variável de ambiente.'
    );
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(rawCredential);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT não é um JSON válido.');
  }

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  logger.info('Firebase Admin inicializado com sucesso');
  return firebaseApp;
}

/** Atalho para Firebase Auth */
export function getFirebaseAuth() {
  getFirebaseAdmin();
  return admin.auth();
}

/** Atalho para Firestore */
export function getFirestore() {
  getFirebaseAdmin();
  return admin.firestore();
}

/** Atalho para FieldValue (serverTimestamp, increment, etc.) */
export const FieldValue = admin.firestore.FieldValue;