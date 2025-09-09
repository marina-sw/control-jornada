let currentState = "out";
let todayData = {
  date: new Date().toISOString().split("T")[0],
  entries: [],
  workedMinutes: 0,
  lunchMinutes: 0,
  hadLunchOut: false,
};
let pendingAction = null;
let workTimer = null;

const SCHEDULE = {
  weekday: {
    minEntry: { hour: 7, minute: 0 },
    maxEntry: { hour: 9, minute: 0 },
    minExit: { hour: 17, minute: 0 },
    maxExit: { hour: 19, minute: 0 },
    mandatoryStart: { hour: 9, minute: 0 },
    mandatoryEnd: { hour: 17, minute: 0 },
    lunchStartMin: { hour: 13, minute: 50 },
    lunchStartMax: { hour: 14, minute: 50 },
    lunchReturnMin: { hour: 14, minute: 30 },
    lunchReturnMax: { hour: 15, minute: 30 },
    requiredMinutes: 510,
  },
  friday: {
    minEntry: { hour: 7, minute: 30 },
    maxEntry: { hour: 8, minute: 30 },
    minExit: { hour: 13, minute: 50 },
    maxExit: { hour: 14, minute: 50 },
    mandatoryStart: { hour: 8, minute: 30 },
    mandatoryEnd: { hour: 13, minute: 50 },
    requiredMinutes: 360,
  },
};

const OVERTIME_REASONS = {
  reunion_urgente: "Reunión urgente",
  proyecto_critico: "Proyecto crítico",
  problema_tecnico: "Problema técnico",
  cliente_importante: "Atención cliente importante",
  formacion: "Formación",
  otro: "Otro",
};

const ACTION_TEXT = {
  enter: "Entrada",
  lunch_out: "Salida comida",
  lunch_back: "Vuelta comida",
  exit: "Salida",
};

function initApp() {
  loadTodayData();

  const today = new Date().toISOString().split("T")[0];
  if (todayData.date !== today) {
    todayData = {
      date: today,
      entries: [],
      workedMinutes: 0,
      lunchMinutes: 0,
      hadLunchOut: false,
    };
    currentState = "out";
  }
  updateDateTime();
  updateDisplay();
  updateButtons();

  if (currentState === "in" || currentState === "lunch_back") {
    startWorkTimer();
  }
  setInterval(updateDateTime, 1000);
}

function loadTodayData() {
  const today = new Date().toISOString().split("T")[0];
  const savedData = localStorage.getItem(`workday_${today}`);

  if (savedData) {
    todayData = JSON.parse(savedData);
    todayData.hadLunchOut = todayData.entries.some(
      (e) => e.type === "lunch_out"
    );

    if (todayData.entries.length > 0) {
      const lastEntry = todayData.entries[todayData.entries.length - 1];
      currentState =
        lastEntry.type === "enter"
          ? "in"
          : lastEntry.type === "lunch_out"
          ? "lunch_out"
          : lastEntry.type === "lunch_back"
          ? "lunch_back"
          : "out";
    }
    calculateWorkedTime();
  } else {
    todayData.date = today;
  }
}

function saveTodayData() {
  localStorage.setItem(`workday_${todayData.date}`, JSON.stringify(todayData));
  saveWeeklyHistory();
}

function saveWeeklyHistory() {
  const dateToSave = new Date(todayData.date);
  const weekStart = getMonday(dateToSave);
  const weekKey = `week_${weekStart.toISOString().split("T")[0]}`;

  let weekData = JSON.parse(localStorage.getItem(weekKey) || "{}");
  weekData[todayData.date] = todayData;
  localStorage.setItem(weekKey, JSON.stringify(weekData));
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function updateDateTime() {
  const now = new Date();

  const dateOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  document.getElementById("currentDate").textContent = now.toLocaleDateString(
    "es-ES",
    dateOptions
  );

  const timeOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit" };
  document.getElementById("currentTime").textContent = now.toLocaleTimeString(
    "es-ES",
    timeOptions
  );
}

function addManualEntry() {
  const type = document.getElementById("manualType").value;
  const timeStr = document.getElementById("manualTime").value;
  if (!timeStr) {
    showAlert("Introduce una hora válida", "warning");
    return;
  }

  const [hours, minutes] = timeStr.split(":").map(Number);
  const entryDate = new Date();
  entryDate.setHours(hours, minutes, 0, 0);

  const tempEntries = [
    ...todayData.entries,
    { type, time: entryDate.toISOString() },
  ];
  tempEntries.sort((a, b) => new Date(a.time) - new Date(b.time));

  const typeOrder = { enter: 1, lunch_out: 2, lunch_back: 3, exit: 4 };
  let lastTypeOrder = 0;
  for (const entry of tempEntries) {
    const currentTypeOrder = typeOrder[entry.type];
    if (currentTypeOrder < lastTypeOrder) {
      showAlert(
        "El orden cronológico de los registros es incorrecto.",
        "warning"
      );
      return;
    }
    lastTypeOrder = currentTypeOrder;
  }
  const isOvertime = isOvertimeAction(type, entryDate);

  if (isOvertime) {
    pendingAction = { type: type, time: entryDate };
    showOvertimeDialog();
  } else {
    executeAction(type, entryDate);
  }
}

function handleAction(action) {
  const now = new Date();
  const isOvertime = isOvertimeAction(action, now);

  if (isOvertime) {
    pendingAction = { type: action, time: now };
    showOvertimeDialog();
  } else {
    executeAction(action, now);
  }
}

function isOvertimeAction(action, time) {
  const dayOfWeek = time.getDay();
  const isFriday = dayOfWeek === 5;
  const schedule = isFriday ? SCHEDULE.friday : SCHEDULE.weekday;

  const hour = time.getHours();
  const minute = time.getMinutes();
  const totalMinutes = hour * 60 + minute;

  switch (action) {
    case "enter":
      const minEntry = schedule.minEntry.hour * 60 + schedule.minEntry.minute;
      const maxEntry = schedule.maxEntry.hour * 60 + schedule.maxEntry.minute;
      return totalMinutes < minEntry || totalMinutes > maxEntry;

    case "exit":
      const minExit = schedule.minExit.hour * 60 + schedule.minExit.minute;
      const maxExit = schedule.maxExit.hour * 60 + schedule.maxExit.minute;
      return totalMinutes < minExit || totalMinutes > maxExit;

    case "lunch_out":
      if (!isFriday) {
        const lunchStartMin =
          schedule.lunchStartMin.hour * 60 + schedule.lunchStartMin.minute;
        const lunchStartMax =
          schedule.lunchStartMax.hour * 60 + schedule.lunchStartMax.minute;
        return totalMinutes < lunchStartMin || totalMinutes > lunchStartMax;
      }
      return false;

    case "lunch_back":
      if (!isFriday) {
        const lunchReturnMin =
          schedule.lunchReturnMin.hour * 60 + schedule.lunchReturnMin.minute;
        const lunchReturnMax =
          schedule.lunchReturnMax.hour * 60 + schedule.lunchReturnMax.minute;
        return totalMinutes < lunchReturnMin || totalMinutes > lunchReturnMax;
      }
      return false;

    default:
      return false;
  }
}

function showOvertimeDialog() {
  document.getElementById("overtimeSection").classList.add("active");
}

function confirmOvertimeAction() {
  const reason = document.getElementById("overtimeReason").value;
  const description = document.getElementById("overtimeDescription").value;

  if (!reason) {
    showAlert("Por favor selecciona un motivo", "warning");
    return;
  }
  executeAction(
    pendingAction.type,
    pendingAction.time,
    true,
    reason,
    description
  );

  document.getElementById("overtimeSection").classList.remove("active");
  document.getElementById("overtimeReason").value = "";
  document.getElementById("overtimeDescription").value = "";
  pendingAction = null;
}

function executeAction(
  action,
  time,
  isOvertime = false,
  reason = "",
  description = ""
) {
  const existingEntryIndex = todayData.entries.findIndex(
    (entry) => entry.type === action
  );
  if (existingEntryIndex > -1) {
    todayData.entries.splice(existingEntryIndex, 1);
  }

  const entry = {
    type: action,
    time: time.toISOString(),
    hour: time.getHours(),
    minute: time.getMinutes(),
    isOvertime,
    reason,
    description,
  };

  todayData.entries.push(entry);
  todayData.entries.sort((a, b) => new Date(a.time) - new Date(b.time));
  const lastEntry = todayData.entries[todayData.entries.length - 1];

  switch (lastEntry.type) {
    case "enter":
    case "lunch_back":
      currentState = lastEntry.type === "enter" ? "in" : "lunch_back";
      startWorkTimer();
      break;
    case "lunch_out":
      currentState = "lunch_out";
      todayData.hadLunchOut = true;
      stopWorkTimer();
      break;
    case "exit":
      currentState = "out";
      stopWorkTimer();
      break;
  }
  showAlert(`${ACTION_TEXT[action]} registrada`, "success");

  calculateWorkedTime();
  updateDisplay();
  updateButtons();
  saveTodayData();
}

function startWorkTimer() {
  if (workTimer) clearInterval(workTimer);
  workTimer = setInterval(() => {
    calculateWorkedTime();
    updateDisplay();
  }, 1000);
}

function stopWorkTimer() {
  if (workTimer) {
    clearInterval(workTimer);
    workTimer = null;
  }
}

function calculateWorkedTime() {
  let workedMinutes = 0;
  let currentPeriodStart = null;
  const entryDate =
    todayData.entries.length > 0
      ? new Date(todayData.entries[0].time)
      : new Date();
  const isFriday = entryDate.getDay() === 5;
  let hadEntry = todayData.entries.some((e) => e.type === "enter");
  todayData.hadLunchOut = todayData.entries.some((e) => e.type === "lunch_out");

  for (const entry of todayData.entries) {
    const entryTime = new Date(entry.time);

    if (entry.type === "enter" || entry.type === "lunch_back") {
      currentPeriodStart = entryTime;
    } else if (
      (entry.type === "lunch_out" || entry.type === "exit") &&
      currentPeriodStart
    ) {
      workedMinutes += (entryTime - currentPeriodStart) / (1000 * 60);
      currentPeriodStart = null;
    }
  }

  if (
    currentPeriodStart &&
    (currentState === "in" || currentState === "lunch_back")
  ) {
    workedMinutes += (new Date() - currentPeriodStart) / (1000 * 60);
  }

  if (hadEntry && todayData.hadLunchOut) {
    workedMinutes = Math.max(0, workedMinutes - 20);
  }
  todayData.workedMinutes = Math.floor(workedMinutes);
}

function updateDisplay() {
  const isFriday = new Date().getDay() === 5;
  const requiredMinutes = isFriday
    ? SCHEDULE.friday.requiredMinutes
    : SCHEDULE.weekday.requiredMinutes;

  const statusText = {
    out: "Fuera",
    in: "Trabajando",
    lunch_out: "En Comida",
    lunch_back: "Trabajando",
  };

  const statusElement = document.getElementById("workStatus");
  statusElement.textContent = statusText[currentState];
  statusElement.className =
    "status-value " +
    (currentState === "in" || currentState === "lunch_back" ? "working" : "");

  const workedHours = Math.floor(todayData.workedMinutes / 60);
  const workedMins = todayData.workedMinutes % 60;
  document.getElementById("workedHours").textContent = `${workedHours
    .toString()
    .padStart(2, "0")}:${workedMins.toString().padStart(2, "0")}`;

  const remainingMinutes = Math.max(
    0,
    requiredMinutes - todayData.workedMinutes
  );
  const remainingHours = Math.floor(remainingMinutes / 60);
  const remainingMins = remainingMinutes % 60;

  const remainingElement = document.getElementById("remainingHours");
  if (todayData.workedMinutes >= requiredMinutes) {
    const overtimeMinutes = todayData.workedMinutes - requiredMinutes;
    const overtimeHours = Math.floor(overtimeMinutes / 60);
    const overtimeMins = overtimeMinutes % 60;
    remainingElement.textContent = `+${overtimeHours
      .toString()
      .padStart(2, "0")}:${overtimeMins.toString().padStart(2, "0")}`;
    remainingElement.className = "status-value overtime";
  } else {
    remainingElement.textContent = `${remainingHours
      .toString()
      .padStart(2, "0")}:${remainingMins.toString().padStart(2, "0")}`;
    remainingElement.className = "status-value";
  }
  const exitElement = document.getElementById("estimatedExit");

  if (currentState === "in") {
    if (isFriday) {
      const now = new Date();
      const estimatedExit = new Date(
        now.getTime() + remainingMinutes * 60000 + 20 * 60000
      );
      const exitHour = estimatedExit.getHours().toString().padStart(2, "0");
      const exitMinute = estimatedExit.getMinutes().toString().padStart(2, "0");
      exitElement.textContent = `${exitHour}:${exitMinute}`;
    } else {
      exitElement.textContent = "--:--";
    }
  } else if (currentState === "lunch_out") {
    const lunchOutEntry = todayData.entries.find((e) => e.type === "lunch_out");
    if (lunchOutEntry) {
      const lunchOutTime = new Date(lunchOutEntry.time);
      const minReturn = new Date(
        lunchOutTime.getTime() + 40 * 60000 + remainingMinutes * 60000
      );
      const maxReturn = new Date(
        lunchOutTime.getTime() + 100 * 60000 + remainingMinutes * 60000
      );
      const format = (d) =>
        `${d.getHours().toString().padStart(2, "0")}:${d
          .getMinutes()
          .toString()
          .padStart(2, "0")}`;
      exitElement.textContent = `${format(minReturn)} - ${format(maxReturn)}`;
    } else {
      exitElement.textContent = "--:--";
    }
  } else if (currentState === "lunch_back") {
    const now = new Date();
    const estimatedExit = new Date(now.getTime() + remainingMinutes * 60000);
    const exitHour = estimatedExit.getHours().toString().padStart(2, "0");
    const exitMinute = estimatedExit.getMinutes().toString().padStart(2, "0");
    exitElement.textContent = `${exitHour}:${exitMinute}`;
  } else {
    exitElement.textContent = "--:--";
  }
}

function updateButtons() {
  const buttons = {
    enterBtn: document.getElementById("enterBtn"),
    lunchOutBtn: document.getElementById("lunchOutBtn"),
    lunchBackBtn: document.getElementById("lunchBackBtn"),
    exitBtn: document.getElementById("exitBtn"),
  };
  Object.values(buttons).forEach((btn) => (btn.style.display = "none"));

  const hasEnter = todayData.entries.some((e) => e.type === "enter");
  const hasLunchOut = todayData.entries.some((e) => e.type === "lunch_out");
  const hasLunchBack = todayData.entries.some((e) => e.type === "lunch_back");
  const hasExit = todayData.entries.some((e) => e.type === "exit");
  const isFriday = new Date().getDay() === 5;

  if (hasExit) {
    // Jornada finalizada, no mostrar botones
  } else if (hasLunchBack) {
    buttons.exitBtn.style.display = "block";
  } else if (hasLunchOut) {
    buttons.lunchBackBtn.style.display = "block";
  } else if (hasEnter) {
    if (!isFriday) {
      buttons.lunchOutBtn.style.display = "block";
    }
    buttons.exitBtn.style.display = "block";
  } else {
    buttons.enterBtn.style.display = "block";
  }
}

function showAlert(message, type) {
  const alertContainer = document.getElementById("alertContainer");
  const alertDiv = document.createElement("div");
  alertDiv.className = `alert alert-${type}`;
  alertDiv.textContent = message;
  alertContainer.appendChild(alertDiv);

  setTimeout(() => {
    alertDiv.remove();
  }, 3000);
}

function toggleManualEntry() {
  const manualEntryContent = document.getElementById("manualEntryContent");
  manualEntryContent.classList.toggle("active");
}

function toggleHistory() {
  const historyContent = document.getElementById("historyContent");
  const isVisible = historyContent.classList.contains("active");

  if (isVisible) {
    historyContent.classList.remove("active");
  } else {
    loadWeeklyHistory();
    historyContent.classList.add("active");
  }
}

function loadWeeklyHistory() {
  const today = new Date();
  const weekStart = getMonday(today);
  const weekKey = `week_${weekStart.toISOString().split("T")[0]}`;

  const weekData = JSON.parse(localStorage.getItem(weekKey) || "{}");
  const historyContent = document.getElementById("historyContent");

  let totalWeekMinutes = 0;
  let dailyHtml = "";
  const todayStr = new Date().toISOString().split("T")[0];

  for (let i = 0; i < 5; i++) {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + i);
    const dayKey = day.toISOString().split("T")[0];
    const dayData = weekData[dayKey];

    if (dayData && dayData.workedMinutes) {
      totalWeekMinutes += dayData.workedMinutes;
    }

    const dayName = day.toLocaleDateString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "short",
    });

    dailyHtml += `<div class="day-record">`;
    dailyHtml += `<div class="day-header"> <span>${dayName}</span>`;

    if (dayKey <= todayStr) {
      dailyHtml += `<button class="add-btn" style="padding: 5px 10px;" onclick="openEditModal('${dayKey}')">Editar</button>`;
    }
    dailyHtml += `</div>`;

    if (dayData && dayData.entries.length > 0) {
      const workedHours = Math.floor(dayData.workedMinutes / 60);
      const workedMins = dayData.workedMinutes % 60;

      dailyHtml += `<div class="time-entry"><span>Horas trabajadas:</span><span>${workedHours
        .toString()
        .padStart(2, "0")}:${workedMins
        .toString()
        .padStart(2, "0")}</span></div>`;

      dayData.entries.forEach((entry) => {
        const timeStr = `${entry.hour
          .toString()
          .padStart(2, "0")}:${entry.minute.toString().padStart(2, "0")}`;

        let entryClass = "";
        let entryText = `<span>${
          ACTION_TEXT[entry.type]
        }:</span><span>${timeStr}</span>`;

        if (entry.isOvertime) {
          entryClass = "overtime-entry";
          const reasonText = OVERTIME_REASONS[entry.reason] || entry.reason;
          entryText += ` <small>(${reasonText})</small>`;
        }

        dailyHtml += `<div class="time-entry ${entryClass}">${entryText}</div>`;
      });
    } else {
      dailyHtml += `<div class="time-entry"><span>Sin registros</span></div>`;
    }
    dailyHtml += `</div>`;
  }
  const totalHours = Math.floor(totalWeekMinutes / 60);
  const totalMinutes = totalWeekMinutes % 60;

  const headerHtml = `<h3>Historial de la Semana (Total: ${totalHours
    .toString()
    .padStart(2, "0")}:${totalMinutes.toString().padStart(2, "0")})</h3>`;

  historyContent.innerHTML = headerHtml + dailyHtml;
}

function openEditModal(dayKey) {
  const modal = document.getElementById("editDayModal");
  modal.dataset.dayKey = dayKey;

  const weekStart = getMonday(new Date(dayKey));
  const weekKey = `week_${weekStart.toISOString().split("T")[0]}`;
  const weekData = JSON.parse(localStorage.getItem(weekKey) || "{}");
  let dayData = weekData[dayKey];

  if (!dayData) {
    dayData = { date: dayKey, entries: [], workedMinutes: 0 };
  }

  const modalTitle = document.getElementById("editDayModalTitle");
  const dayName = new Date(dayKey).toLocaleDateString("es-ES", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  modalTitle.textContent = `Editar Jornada: ${dayName}`;

  const container = document.getElementById("existingEntriesContainer");
  let html = "<h4>Registros Existentes</h4>";
  let entryTypes = new Set();
  if (dayData.entries && dayData.entries.length > 0) {
    dayData.entries.forEach((entry, index) => {
      entryTypes.add(entry.type);
      const timeStr = `${entry.hour.toString().padStart(2, "0")}:${entry.minute
        .toString()
        .padStart(2, "0")}`;
      html += `
                        <div class="edit-entry" data-index="${index}">
                            <label>${ACTION_TEXT[entry.type]}:</label>
                            <input type="time" value="${timeStr}">
                            <button class="delete-btn" onclick="this.parentElement.remove()">Eliminar</button>
                            <input type="hidden" value="${entry.type}">
                        </div>
                    `;
    });
  } else {
    html += "<p>No hay registros para este día.</p>";
  }
  container.innerHTML = html;

  const addNewSection = document.getElementById("addNewEntrySection");
  const hasAllEntries = ["enter", "lunch_out", "lunch_back", "exit"].every(
    (type) => entryTypes.has(type)
  );

  if (hasAllEntries) {
    addNewSection.style.display = "none";
  } else {
    addNewSection.style.display = "block";
  }

  modal.style.display = "block";
}

function closeEditModal() {
  const modal = document.getElementById("editDayModal");
  modal.style.display = "none";
}

function addNewEntryToModal() {
  const type = document.getElementById("newEntryType").value;
  const time = document.getElementById("newEntryTime").value;

  if (!time) {
    showAlert("Por favor, introduce una hora.", "warning");
    return;
  }

  const container = document.getElementById("existingEntriesContainer");
  const noRecordsP = container.querySelector("p");
  if (noRecordsP) noRecordsP.remove();

  const newEntryDiv = document.createElement("div");
  newEntryDiv.className = "edit-entry";
  newEntryDiv.dataset.index = "new";

  const label = document.createElement("label");
  label.textContent = `${ACTION_TEXT[type]}:`;

  const timeInput = document.createElement("input");
  timeInput.type = "time";
  timeInput.value = time;

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "Eliminar";
  deleteBtn.onclick = () => newEntryDiv.remove();

  const hiddenInput = document.createElement("input");
  hiddenInput.type = "hidden";
  hiddenInput.value = type;

  newEntryDiv.appendChild(label);
  newEntryDiv.appendChild(timeInput);
  newEntryDiv.appendChild(deleteBtn);
  newEntryDiv.appendChild(hiddenInput);

  container.appendChild(newEntryDiv);
  document.getElementById("newEntryTime").value = "";
}

function saveDayChanges() {
  const modal = document.getElementById("editDayModal");
  const dayKey = modal.dataset.dayKey;

  const weekStart = getMonday(new Date(dayKey));
  const weekKey = `week_${weekStart.toISOString().split("T")[0]}`;
  const weekData = JSON.parse(localStorage.getItem(weekKey) || "{}");

  const newEntries = [];
  const entryElements = document.querySelectorAll(
    "#existingEntriesContainer .edit-entry"
  );

  entryElements.forEach((el) => {
    const timeStr = el.querySelector('input[type="time"]').value;
    const type = el.querySelector('input[type="hidden"]').value;
    const [hour, minute] = timeStr.split(":").map(Number);

    const entryDate = new Date(dayKey);
    entryDate.setHours(hour, minute, 0, 0);

    newEntries.push({
      type: type,
      time: entryDate.toISOString(),
      hour: hour,
      minute: minute,
      isOvertime: false,
      reason: "",
      description: "",
    });
  });
  newEntries.sort((a, b) => new Date(a.time) - new Date(b.time));

  let dayData = weekData[dayKey] || { date: dayKey, entries: [] };
  dayData.entries = newEntries;

  dayData = recalculateWorkedTimeForDay(dayData);

  weekData[dayKey] = dayData;
  localStorage.setItem(weekKey, JSON.stringify(weekData));

  if (dayKey === todayData.date) {
    localStorage.setItem(`workday_${dayKey}`, JSON.stringify(dayData));
    loadTodayData();
    updateDisplay();
    updateButtons();
  }
  showAlert("Jornada actualizada correctamente", "success");
  closeEditModal();
  loadWeeklyHistory();
}

function recalculateWorkedTimeForDay(dayData) {
  dayData.entries.sort((a, b) => new Date(a.time) - new Date(b.time));
  let workedMinutes = 0;
  let currentPeriodStart = null;

  const entryDate =
    dayData.entries.length > 0
      ? new Date(dayData.entries[0].time)
      : new Date(dayData.date);
  const isFriday = entryDate.getDay() === 5;
  let hadEntry = dayData.entries.some((e) => e.type === "enter");
  dayData.hadLunchOut = dayData.entries.some((e) => e.type === "lunch_out");

  for (const entry of dayData.entries) {
    const entryTime = new Date(entry.time);
    if (entry.type === "enter" || entry.type === "lunch_back") {
      currentPeriodStart = entryTime;
    } else if (
      (entry.type === "lunch_out" || entry.type === "exit") &&
      currentPeriodStart
    ) {
      workedMinutes += (entryTime - currentPeriodStart) / (1000 * 60);
      currentPeriodStart = null;
    }
  }

  if (hadEntry && dayData.hadLunchOut) {
    workedMinutes = Math.max(0, workedMinutes - 20);
  }
  dayData.workedMinutes = Math.floor(workedMinutes);
  return dayData;
}

function exportWeekToExcel() {
  const today = new Date();
  const weekStart = getMonday(today);
  const weekKey = `week_${weekStart.toISOString().split("T")[0]}`;

  const weekData = JSON.parse(localStorage.getItem(weekKey) || "{}");

  if (Object.keys(weekData).length === 0) {
    showAlert("No hay datos para exportar en la semana actual.", "warning");
    return;
  }

  const headers = [
    "Fecha",
    "Entrada",
    "Salida Comer",
    "Entrada Comer",
    "Salida",
    "Total",
    "Diferencia",
    "Total Semana",
  ];
  const rows = [headers];
  let totalWeekMinutes = 0;

  for (let i = 0; i < 5; i++) {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + i);
    const dayKey = day.toISOString().split("T")[0];
    const dayData = weekData[dayKey];
    const isFriday = i === 4;

    const rowData = {
      Fecha: dayKey,
      Entrada: "",
      "Salida Comer": "",
      "Entrada Comer": "",
      Salida: "",
      Total: "",
      Diferencia: "",
      "Total Semana": "",
    };

    if (dayData && dayData.entries.length > 0) {
      dayData.entries.forEach((entry) => {
        const timeStr = `${entry.hour
          .toString()
          .padStart(2, "0")}:${entry.minute.toString().padStart(2, "0")}`;
        const reasonText = entry.isOvertime
          ? ` (${OVERTIME_REASONS[entry.reason] || entry.reason})`
          : "";

        switch (entry.type) {
          case "enter":
            rowData["Entrada"] = timeStr + reasonText;
            break;
          case "lunch_out":
            rowData["Salida Comer"] = timeStr + reasonText;
            break;
          case "lunch_back":
            rowData["Entrada Comer"] = timeStr + reasonText;
            break;
          case "exit":
            rowData["Salida"] = timeStr + reasonText;
            break;
        }
      });

      const workedHours = Math.floor(dayData.workedMinutes / 60);
      const workedMins = dayData.workedMinutes % 60;
      rowData["Total"] = `${workedHours
        .toString()
        .padStart(2, "0")}:${workedMins.toString().padStart(2, "0")}`;
      totalWeekMinutes += dayData.workedMinutes;

      const requiredMinutes = isFriday
        ? SCHEDULE.friday.requiredMinutes
        : SCHEDULE.weekday.requiredMinutes;
      const diffMinutes = dayData.workedMinutes - requiredMinutes;
      const sign = diffMinutes >= 0 ? "+" : "-";
      const absDiff = Math.abs(diffMinutes);
      const diffHours = Math.floor(absDiff / 60);
      const diffMins = absDiff % 60;
      rowData["Diferencia"] = `${sign}${diffHours
        .toString()
        .padStart(2, "0")}:${diffMins.toString().padStart(2, "0")}`;
    }

    if (isFriday) {
      const totalHours = Math.floor(totalWeekMinutes / 60);
      const totalMins = totalWeekMinutes % 60;
      rowData["Total Semana"] = `${totalHours
        .toString()
        .padStart(2, "0")}:${totalMins.toString().padStart(2, "0")}`;
    }

    rows.push(Object.values(rowData));
  }
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Jornada Semanal");

  const colWidths = headers.map((header, i) => ({
    wch:
      Math.max(
        header.length,
        ...rows.slice(1).map((row) => (row[i] || "").toString().length)
      ) + 2,
  }));
  worksheet["!cols"] = colWidths;

  XLSX.writeFile(
    workbook,
    `jornada_semanal_${weekStart.toISOString().split("T")[0]}.xlsx`
  );
}
document.addEventListener("DOMContentLoaded", initApp);

window.addEventListener("beforeunload", () => {
  if (workTimer) {
    clearInterval(workTimer);
  }
});

window.onclick = function (event) {
  const modal = document.getElementById("editDayModal");
  if (event.target == modal) {
    modal.style.display = "none";
  }
};
