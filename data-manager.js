// data-manager.js - Capa de abstracción de datos que reemplaza localStorage

class DataManager {
  constructor() {
    // Caché en memoria de todos los datos del usuario
    this.cache = {
      workdays: {}, // { 'YYYY-MM-DD': dayData }
      months: {}    // { 'YYYY-MM': monthData }
    };
    this.pendingSync = false;
    this.lastSyncTime = 0;
  }

  // ==================== MÉTODOS PRINCIPALES ====================

  /**
   * Carga todos los datos del usuario desde Google Sheets
   */
  async loadAllData(username) {
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${AUTH_CONFIG.spreadsheetId}/values/${AUTH_CONFIG.dataSheet}`;
      const headers = await getAuthHeaders();
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        throw new Error(`Error cargando datos: ${response.status}`);
      }
      
      const data = await response.json();
      const rows = data.values || [];
      
      // Filtrar datos del usuario y reconstruir caché
      rows.forEach(row => {
        const [user, dataKey, dataValue] = row;
        if (user !== username || !dataValue) return;
        
        try {
          const parsedData = JSON.parse(dataValue);
          
          if (dataKey.startsWith('workday_')) {
            const date = dataKey.replace('workday_', '');
            this.cache.workdays[date] = parsedData;
          } else if (dataKey.startsWith('month_')) {
            const monthKey = dataKey.replace('month_', '');
            this.cache.months[monthKey] = parsedData;
          }
        } catch (e) {
          console.error(`Error parseando ${dataKey}:`, e);
        }
      });
      
      console.log('Datos cargados desde Google Sheets:', {
        workdays: Object.keys(this.cache.workdays).length,
        months: Object.keys(this.cache.months).length
      });
      
      this.lastSyncTime = Date.now();
      return true;
    } catch (error) {
      console.error('Error en loadAllData:', error);
      return false;
    }
  }

  /**
   * Guarda todos los datos del usuario en Google Sheets
   */
  async saveAllData(username) {
    if (!username) return false;
    
    try {
      this.pendingSync = true;
      
      // Preparar datos para subir
      const dataToSync = [];
      
      // Workdays individuales
      Object.entries(this.cache.workdays).forEach(([date, data]) => {
        dataToSync.push([
          username,
          `workday_${date}`,
          JSON.stringify(data)
        ]);
      });
      
      // Datos mensuales
      Object.entries(this.cache.months).forEach(([monthKey, data]) => {
        dataToSync.push([
          username,
          `month_${monthKey}`,
          JSON.stringify(data)
        ]);
      });
      
      if (dataToSync.length === 0) {
        this.pendingSync = false;
        return true;
      }
      
      // Primero borrar datos antiguos del usuario
      await this.clearUserData(username);
      
      // Subir datos nuevos
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${AUTH_CONFIG.spreadsheetId}/values/${AUTH_CONFIG.dataSheet}:append?valueInputOption=RAW`;
      const headers = await getAuthHeaders();
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ values: dataToSync })
      });
      
      if (!response.ok) {
        throw new Error(`Error guardando datos: ${response.status}`);
      }
      
      console.log(`${dataToSync.length} registros sincronizados con Google Sheets`);
      this.lastSyncTime = Date.now();
      this.pendingSync = false;
      return true;
    } catch (error) {
      console.error('Error en saveAllData:', error);
      this.pendingSync = false;
      return false;
    }
  }

  /**
   * Borra los datos del usuario de Google Sheets antes de actualizarlos
   */
  async clearUserData(username) {
    try {
      // Leer todas las filas
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${AUTH_CONFIG.spreadsheetId}/values/${AUTH_CONFIG.dataSheet}`;
      const headers = await getAuthHeaders();
      let response = await fetch(url, { headers });
      
      if (!response.ok) return;
      
      const data = await response.json();
      const rows = data.values || [];
      
      // Mantener solo las filas que NO son del usuario actual
      const filteredRows = rows.filter(row => row[0] !== username);
      
      // Reescribir la hoja completa
      const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${AUTH_CONFIG.spreadsheetId}/values/${AUTH_CONFIG.dataSheet}:clear`;
      await fetch(clearUrl, {
        method: 'POST',
        headers
      });
      
      if (filteredRows.length > 0) {
        const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${AUTH_CONFIG.spreadsheetId}/values/${AUTH_CONFIG.dataSheet}?valueInputOption=RAW`;
        await fetch(updateUrl, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ values: filteredRows })
        });
      }
    } catch (error) {
      console.error('Error en clearUserData:', error);
    }
  }

  // ==================== MÉTODOS DE ACCESO A DATOS ====================

  /**
   * Obtiene los datos de un día específico
   */
  getWorkday(date) {
    return this.cache.workdays[date] || null;
  }

  /**
   * Guarda los datos de un día específico
   */
  setWorkday(date, data) {
    this.cache.workdays[date] = data;
    this.updateMonthData(date, data);
  }

  /**
   * Obtiene los datos de un mes completo
   */
  getMonth(monthKey) {
    return this.cache.months[monthKey] || {};
  }

  /**
   * Actualiza los datos mensuales cuando cambia un día
   */
  updateMonthData(date, dayData) {
    const [year, month] = date.split('-');
    const monthKey = `${year}-${month}`;
    
    if (!this.cache.months[monthKey]) {
      this.cache.months[monthKey] = {};
    }
    
    this.cache.months[monthKey][date] = dayData;
  }

  /**
   * Obtiene todos los días de un mes
   */
  getMonthDays(year, month) {
    const monthKey = `${year}-${month.toString().padStart(2, '0')}`;
    return this.cache.months[monthKey] || {};
  }

  /**
   * Limpia toda la caché (para logout)
   */
  clearCache() {
    this.cache = {
      workdays: {},
      months: {}
    };
  }
}

// Instancia global
const dataManager = new DataManager();