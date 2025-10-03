class DataManager {
  constructor() {
    // Caché en memoria de todos los datos del usuario
    this.cache = {
      workdays: {}, // { 'YYYY-MM-DD': dayData }
      months: {}    // { 'YYYY-MM': monthData }
    };
    
    // Control de cambios para sincronización inteligente
    this.dirtyKeys = new Set(); // Claves que han cambiado desde última sync
    this.lastSyncTime = 0;
    this.pendingSync = false;
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
      
      // Limpiar marcas de cambios después de cargar
      this.dirtyKeys.clear();
      this.lastSyncTime = Date.now();
      return true;
    } catch (error) {
      console.error('Error en loadAllData:', error);
      return false;
    }
  }

  /**
   * Guarda SOLO los datos modificados en Google Sheets (sincronización incremental)
   */
  async saveAllData(username) {
    if (!username) return false;
    
    // Si no hay cambios, no hacer nada
    if (this.dirtyKeys.size === 0) {
      console.log('No hay cambios para sincronizar');
      return true;
    }
    
    try {
      this.pendingSync = true;
      console.log(`Sincronizando ${this.dirtyKeys.size} registros modificados...`);
      
      // Leer datos actuales de la hoja
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${AUTH_CONFIG.spreadsheetId}/values/${AUTH_CONFIG.dataSheet}`;
      const headers = await getAuthHeaders();
      let response = await fetch(url, { headers });
      
      if (!response.ok) {
        throw new Error(`Error leyendo hoja: ${response.status}`);
      }
      
      const data = await response.json();
      const existingRows = data.values || [];
      
      // Crear mapa de filas existentes del usuario
      const userRowMap = new Map(); // dataKey -> rowIndex
      existingRows.forEach((row, index) => {
        if (row[0] === username) {
          userRowMap.set(row[1], index);
        }
      });
      
      // Preparar actualizaciones batch
      const updates = [];
      
      for (const dirtyKey of this.dirtyKeys) {
        let dataValue;
        
        // Determinar de dónde viene el dato
        if (dirtyKey.startsWith('workday_')) {
          const date = dirtyKey.replace('workday_', '');
          dataValue = this.cache.workdays[date];
        } else if (dirtyKey.startsWith('month_')) {
          const monthKey = dirtyKey.replace('month_', '');
          dataValue = this.cache.months[monthKey];
        }
        
        if (!dataValue) continue;
        
        const rowData = [username, dirtyKey, JSON.stringify(dataValue)];
        const existingRowIndex = userRowMap.get(dirtyKey);
        
        if (existingRowIndex !== undefined) {
          // Actualizar fila existente
          const range = `${AUTH_CONFIG.dataSheet}!A${existingRowIndex + 1}:C${existingRowIndex + 1}`;
          updates.push({
            range: range,
            values: [rowData]
          });
        } else {
          // Añadir nueva fila al final
          updates.push({
            range: `${AUTH_CONFIG.dataSheet}!A${existingRows.length + updates.length + 1}`,
            values: [rowData]
          });
        }
      }
      
      // Ejecutar actualización batch
      if (updates.length > 0) {
        const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${AUTH_CONFIG.spreadsheetId}/values:batchUpdate`;
        response = await fetch(batchUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            valueInputOption: 'RAW',
            data: updates
          })
        });
        
        if (!response.ok) {
          throw new Error(`Error en batch update: ${response.status}`);
        }
      }
      
      console.log(`✓ ${updates.length} registros sincronizados correctamente`);
      
      // Limpiar marcas de cambios
      this.dirtyKeys.clear();
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
   * Borra los datos del usuario de Google Sheets (solo usar al borrar cuenta)
   */
  async clearUserData(username) {
    try {
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
    
    // Marcar como modificado para próxima sincronización
    this.dirtyKeys.add(`workday_${date}`);
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
    
    // Marcar mes como modificado
    this.dirtyKeys.add(`month_${monthKey}`);
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
    this.dirtyKeys.clear();
  }

  /**
   * Devuelve estadísticas de sincronización
   */
  getSyncStats() {
    return {
      pendingChanges: this.dirtyKeys.size,
      lastSync: this.lastSyncTime ? new Date(this.lastSyncTime).toLocaleString('es-ES') : 'Nunca',
      isSyncing: this.pendingSync
    };
  }
}

// Instancia global
const dataManager = new DataManager();