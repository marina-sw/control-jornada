// auth.js - Sistema de autenticación y sincronización con Google Sheets

const AUTH_CONFIG = {
  apiKey: 'AIzaSyBp71_A_McQVewKt0Rnry9q7drzrUGGpGs',
  spreadsheetId: '1p2hL9M2uHxS7WbazHZtfoeo0jih2kWTYyPR53A-AU-Y',
  usersSheet: 'Usuarios',
  dataSheet: 'Registros'
};

const SERVICE_ACCOUNT = {
  client_email: "fichador-service@fichador-ec719.iam.gserviceaccount.com",
  private_key: `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCztDyKl0LPZVBO\nk2QUw6fXu0GgdVMliCHqT6Vn3fERNBLea4ji0vGd0cxNHXQbkC8In9+9wdoB2tZ9\nIrm3g7BJUKUlqWItRNLL2xO25MFOpeM+5P+1qWeZ/Lw5NJEJDuXhPHTLBRhHLgfS\n/LRIMeg9OEFBCr7cAyZQ6qTGhhijScstHYqJYbW0sSa4Hh4qQxre1uK/S7NKwWKQ\n1Q+9oCXrrNW1UVdmk1GA8ILVZFNhYEiubt75bPQQp1yViWnLxdEM8f2xRhH/cKrC\nFOG9bE51YvEml5ME3XdHr9rR4Tlb3HMd8E1tysW1RkLOm993KvxtZ/q48XdNNVDp\nZa5UClr7AgMBAAECggEAE3KjhKonCFPiE4be82JTRUUWLpvT4kFvzjBNaca6oo58\npkaD+2wxys8cKZJQ8PSzKl9G8v3KLp40zTkXWTVuvBh2rvM8VULX/0jXwtjR1MWe\nKL3WsJ3DQQZ5hkValtzeYvhMeXY1MOrZ3OsNRazlAc8XPMdBbYUHvgUOzQ9RFkak\n4krh5clO55o+m9dRP9cpM8lNz6PoddR59ag1IIoaUPEmDJyqZwtsNdWg3Io5fdw2\nhHuXJkm0udyM3BUPO9/2Gp4ikT6Xu31fv6+E+khGENfbfSHh0K0vjiZq35g+G4a4\nEEpj8T2DBbANuDYyzxcETL5VYgOZKq10GbwNV6IwOQKBgQDzg+eSqcITGWLYnldC\nT+DV7uYgU9EUi+Ha09oQd+xABGCRdPF0vaH1NWls96K3N7J1ehwjVnsm9SgT/Qtx\nPNQyuRYoXr+QyPgs/e7yRhnwyLmbTwo4LiqHybRPYuODm8JgWuMG3Z6z2SiuwTf4\nKohIqagxlbWkfFCaAWYmF5QGuQKBgQC86tIpApLZ0P2y0beD8HV4UdQUMaEzkpHK\nU+Kow1I7TShjlxDR544S0MIXwU+M5ExNW+o3doR4dqTQV5jeMZizVOo100TCbrhV\nck/2JpZflU+lifjGG/t1f64VyIBK3W9TPoz8zKZrp9kXqURkba+zP/tDysjtpGuy\nn0xkfvcVUwKBgCkZaRsqxZOdpD41MzsA6kyRHov0OYSDO2JIgTRoWRpQ4s+J8jqm\nys/s7Nc0UGUl5FvJeThJn01q8RG2kpjREGtjK6cynphcIu7NCOghBr3J0vGwfGQQ\n/qKeW21OnmGXB05l6I0/GEr4atJb0At1ejzxTW7Y+qhBRwVHGStyrUwZAoGAATgm\nyRr6JavCp2/RFmnr6C3nB4ZWewW8KSkncl1oX3edBh+IfUJYWWi9h/e4crlagLlS\nJq9+JWTmpW2bT/vT93xZ0qUdcX/TcsG9IGKZX96P2Aqu72Bo3BZJ4lwb79/EAy6J\nLGyJunIn5Y4zIc7PboHANmzNpTMFeu6qSI/FOn8CgYEA5V7x3GIcWz+FIAatYo0q\ntHF4yw76J3T0xD+2FexsyoO4A77q/qiBSM4bOa4IzOWA7bMCUACI28AxxIr2iNiP\nOECslY2SSBZL9DjD5ii2xxLpwajue+riqR8f3LWHqzBBCqIn16pGipvdiOHCp70N\nsrqdPmivQV6bPpBOuZVWe90=\n-----END PRIVATE KEY-----\n`
};

let currentUser = null;
let syncInterval = null;
let cachedAccessToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && now < cachedTokenExpiry - 30) {
    return cachedAccessToken;
  }

  const header = { alg: "RS256", typ: "JWT" };
  const iat = now;
  const exp = now + 3600;
  const payload = {
    iss: SERVICE_ACCOUNT.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: exp,
    iat: iat
  };

  const sHeader = JSON.stringify(header);
  const sPayload = JSON.stringify(payload);

  // Firmar JWT (jsrsasign)
  let jwt;
  try {
    jwt = KJUR.jws.JWS.sign("RS256", sHeader, sPayload, SERVICE_ACCOUNT.private_key);
  } catch (e) {
    console.error("Error firmando JWT:", e);
    throw new Error("Error firmando JWT: " + e.message);
  }

  // Intercambiar JWT por access_token
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`
  });

  if (!tokenResp.ok) {
    const text = await tokenResp.text();
    console.error("Token exchange failed:", tokenResp.status, text);
    throw new Error("Error obteniendo access_token: " + text);
  }

  const tokenData = await tokenResp.json();
  if (!tokenData.access_token) {
    console.error("Respuesta inválida token:", tokenData);
    throw new Error("No se obtuvo access_token");
  }

  cachedAccessToken = tokenData.access_token;
  cachedTokenExpiry = now + (tokenData.expires_in || 3600);

  return cachedAccessToken;
}

// Helper para cabeceras autorizadas
async function getAuthHeaders() {
  const token = await getAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

// ----------------- Resto de tu lógica (ajustada) -----------------

function initAuth() {
  const savedUser = sessionStorage.getItem('currentUser');
  if (savedUser) {
    currentUser = savedUser;
    showMainApp();
    loadUserDataFromCloud();
    startAutoSync();
  } else {
    showLoginScreen();
  }
}

function showLoginScreen() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('mainApp').style.display = 'none';
}

function showMainApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';
  document.getElementById('currentUserDisplay').textContent = currentUser;
}

async function handleLogin() {
  const username = document.getElementById('usernameInput').value.trim();
  
  if (!username) {
    showAlert('Por favor, introduce un nombre de usuario', 'warning');
    return;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    showAlert('El usuario solo puede contener letras, números, guiones y guiones bajos', 'warning');
    return;
  }
  document.getElementById('loginBtn').disabled = true;
  document.getElementById('loginBtn').textContent = 'Conectando...';

  try {
    await verifyOrCreateUser(username);
    
    currentUser = username;
    sessionStorage.setItem('currentUser', username);
    
    await loadUserDataFromCloud();
    
    showMainApp();
    if (typeof initApp === 'function') initApp();
    startAutoSync();
    showAlert(`Bienvenido, ${username}!`, 'success');
  } catch (error) {
    console.error('Error en login:', error);
    showAlert('Error al conectar. Verifica tu conexión y las credenciales de la API.', 'error');
    document.getElementById('loginBtn').disabled = false;
    document.getElementById('loginBtn').textContent = 'Entrar';
  }
}

function handleLogout() {
  if (confirm('¿Seguro que quieres cerrar sesión? Los datos se sincronizarán antes de salir.')) {
    syncDataToCloud().then(() => {
      stopAutoSync();
      currentUser = null;
      sessionStorage.removeItem('currentUser');
      showLoginScreen();
      document.getElementById('usernameInput').value = '';
    });
  }
}

async function verifyOrCreateUser(username) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${AUTH_CONFIG.spreadsheetId}/values/${AUTH_CONFIG.usersSheet}`;
  
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const text = await response.text();
      console.error("Error al leer usuarios:", response.status, text);
      throw new Error("Error al leer usuarios: " + text);
    }
    const data = await response.json();
    const users = data.values || [];
    const userExists = users.some(row => row[0] === username);
    
    if (!userExists) {
      await createNewUser(username);
    }
    return true;
  } catch (error) {
    console.error('Error verificando usuario:', error);
    throw error;
  }
}

async function createNewUser(username) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${AUTH_CONFIG.spreadsheetId}/values/${AUTH_CONFIG.usersSheet}:append?valueInputOption=RAW`;
  const newUser = {
    values: [[username, new Date().toISOString()]]
  };

  const headers = await getAuthHeaders();
  
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(newUser)
  });
  
  if (!response.ok) {
    const text = await response.text();
    console.error("Error creando usuario:", response.status, text);
    throw new Error('Error creando usuario: ' + text);
  }
}

async function loadUserDataFromCloud() {
  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${AUTH_CONFIG.spreadsheetId}/values/${AUTH_CONFIG.dataSheet}`;
    const headers = await getAuthHeaders();
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const text = await response.text();
      console.error("Error leyendo datos:", response.status, text);
      showAlert('Error al cargar datos. Se usarán los datos locales.', 'warning');
      return;
    }
    const data = await response.json();
    const rows = data.values || [];
    
    const userData = rows.filter(row => row[0] === currentUser);
    
    if (userData.length > 0) {
      userData.forEach(row => {
        const [user, dataKey, dataValue] = row;
        if (dataValue) {
          localStorage.setItem(dataKey, dataValue);
        }
      });
      console.log(`Datos de ${currentUser} cargados desde la nube`);
    }
  } catch (error) {
    console.error('Error cargando datos desde la nube:', error);
    showAlert('Error al cargar datos. Se usarán los datos locales.', 'warning');
  }
}

async function syncDataToCloud() {
  if (!currentUser) return;
  
  try {
    const dataToSync = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      
      if (key.startsWith('workday_') || key.startsWith('month_')) {
        const value = localStorage.getItem(key);
        dataToSync.push([currentUser, key, value]);
      }
    }
    
    if (dataToSync.length === 0) return;
    await clearUserDataFromCloud();
    
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${AUTH_CONFIG.spreadsheetId}/values/${AUTH_CONFIG.dataSheet}:append?valueInputOption=RAW`;
    const headers = await getAuthHeaders();
    
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ values: dataToSync })
    });
    
    if (response.ok) {
      console.log('Datos sincronizados con éxito');
    } else {
      const text = await response.text();
      console.error("Error subiendo datos:", response.status, text);
    }
  } catch (error) {
    console.error('Error sincronizando datos:', error);
  }
}

async function clearUserDataFromCloud() {
  try {
    return;
  } catch (error) {
    console.error('Error limpiando datos:', error);
  }
}

// Sincronización automática
function startAutoSync() {
  syncInterval = setInterval(() => {
    syncDataToCloud();
  }, 5 * 60 * 1000);
  
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      syncDataToCloud();
    }
  });
}

function stopAutoSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

function manualSync() {
  const btn = document.getElementById('syncBtn');
  btn.disabled = true;
  btn.textContent = 'Sincronizando...';
  
  syncDataToCloud().then(() => {
    showAlert('Datos sincronizados correctamente', 'success');
    btn.disabled = false;
    btn.textContent = '🔄';
  }).catch(() => {
    showAlert('Error en la sincronización', 'error');
    btn.disabled = false;
    btn.textContent = '🔄';
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuth);
} else {
  initAuth();
}