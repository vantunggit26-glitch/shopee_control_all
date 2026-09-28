import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyD53nJqEn-nfHpc4V_gQCl_4qH_mMzNomE',
  authDomain: 'account-vault-tung.firebaseapp.com',
  projectId: 'account-vault-tung',
  storageBucket: 'account-vault-tung.firebasestorage.app',
  messagingSenderId: '664664813570',
  appId: '1:664664813570:web:4cfda5e7f767d3cda5b71b',
}

const firebaseApp = initializeApp(firebaseConfig)

export const auth = getAuth(firebaseApp)
export const db = getFirestore(firebaseApp)
export const FIREBASE_LOGIN_EMAIL = 'tungtv@account.com'
