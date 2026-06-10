// src/config/firebase.js
// Inicializa o Firebase Admin SDK uma única vez (singleton pattern)

import admin from 'firebase-admin';
import logger from '../utils/logger.js';

let firebaseApp = null;

/**
 * Retorna a instância do Firebase Admin, inicializando se necessário.
 * Lança erro claro se a env var estiver ausente.
 */
export function getFirebaseAdmin() {
  if (firebaseApp) return firebaseApp;

  const rawCredential = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!rawCredential) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT não definida. ' +
      'Cole o JSON da service account na variável de ambiente.'
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

/**
 * Atalho para o auth do Firebase.
 */
export function getFirebaseAuth() {
  getFirebaseAdmin();      // garante inicialização
  return admin.auth();
}
