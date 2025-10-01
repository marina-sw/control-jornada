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
let overtimePopupTimer = null;

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

  const reasonSelect = document.getElementById("overtimeReason");
  const descriptionInput = document.getElementById("overtimeDescription");

  const clearOvertimeTimer = () => {
    if (overtimePopupTimer) {
      clearTimeout(overtimePopupTimer);
      overtimePopupTimer = null;
    }
  };

  reasonSelect.addEventListener("change", clearOvertimeTimer);
  descriptionInput.addEventListener("input", clearOvertimeTimer);
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
  saveMonthlyHistory();
}

function saveMonthlyHistory() {
  const [year, month, day] = todayData.date.split("-").map(Number);
  const dateToSave = new Date(year, month - 1, day);
  const monthKey = `month_${dateToSave.getFullYear()}-${(
    dateToSave.getMonth() + 1
  )
    .toString()
    .padStart(2, "0")}`;

  let monthData = JSON.parse(localStorage.getItem(monthKey) || "{}");
  monthData[todayData.date] = todayData;
  localStorage.setItem(monthKey, JSON.stringify(monthData));
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
  if (overtimePopupTimer) {
    clearTimeout(overtimePopupTimer);
  }
  overtimePopupTimer = setTimeout(() => {
    document.getElementById("overtimeSection").classList.remove("active");
    pendingAction = null;
    showAlert("Acción extraordinaria cancelada por inactividad.", "warning");
  }, 8000);
}

function confirmOvertimeAction() {
  if (overtimePopupTimer) {
    clearTimeout(overtimePopupTimer);
    overtimePopupTimer = null;
  }

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
  if (action === "lunch_back") {
    const lunchOutEntry = todayData.entries.find((e) => e.type === "lunch_out");
    if (lunchOutEntry) {
      const lunchOutTime = new Date(lunchOutEntry.time);
      const lunchBackTime = time;
      const diffMinutes = (lunchBackTime - lunchOutTime) / (1000 * 60);

      if (diffMinutes < 40) {
        const returnTime = new Date(lunchOutTime.getTime() + 40 * 60000);
        const hours = returnTime.getHours().toString().padStart(2, "0");
        const minutes = returnTime.getMinutes().toString().padStart(2, "0");
        showAlert(
          `La comida debe ser de un mínimo de 40 minutos. Deberías volver a las ${hours}:${minutes}.`,
          "warning"
        );
        return;
      }
    }
  }

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

  if (hadEntry && (isFriday || todayData.hadLunchOut)) {
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
      const estimatedExit = new Date(now.getTime() + remainingMinutes * 60000);
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

function toggleMonthlyHistory() {
  const historyContent = document.getElementById("historyContent");
  const isVisible = historyContent.classList.contains("active");

  if (isVisible) {
    historyContent.classList.remove("active");
  } else {
    loadMonthlyHistory();
    historyContent.classList.add("active");
  }
}

function loadMonthlyHistory() {
  const today = new Date();
  const monthKey = `month_${today.getFullYear()}-${(today.getMonth() + 1)
    .toString()
    .padStart(2, "0")}`;

  const monthData = JSON.parse(localStorage.getItem(monthKey) || "{}");
  const historyContent = document.getElementById("historyContent");

  let totalMonthMinutes = 0;
  let weeksHtml = "";
  const todayStr = new Date().toISOString().split("T")[0];

  const daysInMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0
  ).getDate();

  const weeks = {};

  for (let i = 1; i <= daysInMonth; i++) {
    const day = new Date(today.getFullYear(), today.getMonth(), i);
    const dayOfWeek = day.getDay();

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      continue;
    }

    const year = day.getFullYear();
    const month = (day.getMonth() + 1).toString().padStart(2, "0");
    const dayOfMonth = day.getDate().toString().padStart(2, "0");
    const dayKey = `${year}-${month}-${dayOfMonth}`;

    const dayData = monthData[dayKey];

    if (dayData && dayData.workedMinutes) {
      totalMonthMinutes += dayData.workedMinutes;
    }

    const weekNumber = getWeekOfYear(day);

    if (!weeks[weekNumber]) {
      weeks[weekNumber] = { days: [], totalMinutes: 0 };
    }

    weeks[weekNumber].days.push({ day, dayKey, dayData });
    if (dayData && dayData.workedMinutes) {
      weeks[weekNumber].totalMinutes += dayData.workedMinutes;
    }
  }

  for (const weekNumber in weeks) {
    const week = weeks[weekNumber];
    const weeklyHours = Math.floor(week.totalMinutes / 60);
    const weeklyMins = week.totalMinutes % 60;

    weeksHtml += `<details class="week-record">`;
    weeksHtml += `<summary class="week-header">Semana ${weekNumber} <span>(Total: ${weeklyHours
      .toString()
      .padStart(2, "0")}:${weeklyMins
      .toString()
      .padStart(2, "0")})</span></summary>`;

    let dailyHtml = "";
    for (const dayInfo of week.days) {
      const { day, dayKey, dayData } = dayInfo;
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
    weeksHtml += dailyHtml;
    weeksHtml += `</details>`;
  }

  const totalHours = Math.floor(totalMonthMinutes / 60);
  const totalMinutes = totalMonthMinutes % 60;

  const headerHtml = `<h3>Historial del Mes (Total: ${totalHours
    .toString()
    .padStart(2, "0")}:${totalMinutes.toString().padStart(2, "0")})</h3>`;

  historyContent.innerHTML = headerHtml + weeksHtml;
}

function openEditModal(dayKey) {
  const modal = document.getElementById("editDayModal");
  modal.dataset.dayKey = dayKey;

  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  const monthKey = `month_${date.getFullYear()}-${(date.getMonth() + 1)
    .toString()
    .padStart(2, "0")}`;
  const monthData = JSON.parse(localStorage.getItem(monthKey) || "{}");
  let dayData = monthData[dayKey];

  if (!dayData) {
    dayData = { date: dayKey, entries: [], workedMinutes: 0 };
  }

  const modalTitle = document.getElementById("editDayModalTitle");
  const dayName = date.toLocaleDateString("es-ES", {
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

  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  const monthKey = `month_${date.getFullYear()}-${(date.getMonth() + 1)
    .toString()
    .padStart(2, "0")}`;
  const monthData = JSON.parse(localStorage.getItem(monthKey) || "{}");

  const newEntries = [];
  const entryElements = document.querySelectorAll(
    "#existingEntriesContainer .edit-entry"
  );

  entryElements.forEach((el) => {
    const timeStr = el.querySelector('input[type="time"]').value;
    const type = el.querySelector('input[type="hidden"]').value;
    const [hour, minute] = timeStr.split(":").map(Number);

    const entryDate = new Date(year, month - 1, day, hour, minute);

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

  const lunchOutEntry = newEntries.find((e) => e.type === "lunch_out");
  const lunchBackEntry = newEntries.find((e) => e.type === "lunch_back");

  if (lunchOutEntry && lunchBackEntry) {
    const lunchOutTime = new Date(lunchOutEntry.time);
    const lunchBackTime = new Date(lunchBackEntry.time);
    const diffMinutes = (lunchBackTime - lunchOutTime) / (1000 * 60);

    if (diffMinutes < 40) {
      const returnTime = new Date(lunchOutTime.getTime() + 40 * 60000);
      const hours = returnTime.getHours().toString().padStart(2, "0");
      const minutes = returnTime.getMinutes().toString().padStart(2, "0");
      showAlert(
        `La comida debe ser de un mínimo de 40 minutos. Deberías volver a las ${hours}:${minutes}.`,
        "warning"
      );
      return;
    }
  }

  let dayData = monthData[dayKey] || { date: dayKey, entries: [] };
  dayData.entries = newEntries;

  dayData = recalculateWorkedTimeForDay(dayData);

  monthData[dayKey] = dayData;
  localStorage.setItem(monthKey, JSON.stringify(monthData));

  if (dayKey === todayData.date) {
    localStorage.setItem(`workday_${dayKey}`, JSON.stringify(dayData));
    loadTodayData();
    updateDisplay();
    updateButtons();
  }
  showAlert("Jornada actualizada correctamente", "success");
  closeEditModal();
  loadMonthlyHistory();
}

function recalculateWorkedTimeForDay(dayData) {
  dayData.entries.sort((a, b) => new Date(a.time) - new Date(b.time));
  let workedMinutes = 0;
  let currentPeriodStart = null;

  const [year, month, day] = dayData.date.split("-").map(Number);
  const entryDate =
    dayData.entries.length > 0
      ? new Date(dayData.entries[0].time)
      : new Date(year, month - 1, day);
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

  if (hadEntry && (isFriday || dayData.hadLunchOut)) {
    workedMinutes = Math.max(0, workedMinutes - 20);
  }
  dayData.workedMinutes = Math.floor(workedMinutes);
  return dayData;
}

function exportMonthToExcel() {
  const today = new Date();
  const monthKey = `month_${today.getFullYear()}-${(today.getMonth() + 1)
    .toString()
    .padStart(2, "0")}`;

  const monthData = JSON.parse(localStorage.getItem(monthKey) || "{}");

  if (Object.keys(monthData).length === 0) {
    showAlert("No hay datos para exportar en el mes actual.", "warning");
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
  ];
  const rows = [headers];
  let totalMonthMinutes = 0;

  const daysInMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0
  ).getDate();

  for (let i = 1; i <= daysInMonth; i++) {
    const day = new Date(today.getFullYear(), today.getMonth(), i);
    const dayKey = `${day.getFullYear()}-${(day.getMonth() + 1).toString().padStart(2, '0')}-${day.getDate().toString().padStart(2, '0')}`;
    const dayData = monthData[dayKey];
    const isFriday = day.getDay() === 5;

    const rowData = {
      Fecha: dayKey,
      Entrada: "",
      "Salida Comer": "",
      "Entrada Comer": "",
      Salida: "",
      Total: "",
      Diferencia: "",
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
      totalMonthMinutes += dayData.workedMinutes;

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
    rows.push(Object.values(rowData));
  }

  const totalHours = Math.floor(totalMonthMinutes / 60);
  const totalMins = totalMonthMinutes % 60;
  rows.push([
    "",
    "",
    "",
    "",
    "Total Mes",
    `${totalHours.toString().padStart(2, "0")}:${totalMins
      .toString()
      .padStart(2, "0")}`,
    "",
  ]);

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Jornada Mensual");

  const colWidths = headers.map((header, i) => ({
    wch:
      Math.max(
        header.length,
        ...rows.map((row) => (row[i] || "").toString().length)
      ) + 2,
  }));
  worksheet["!cols"] = colWidths;

  XLSX.writeFile(
    workbook,
    `jornada_mensual_${today.getFullYear()}-${(today.getMonth() + 1)
      .toString()
      .padStart(2, "0")}.xlsx`
  );
}

function exportPreviousMonthToExcel() {
  const today = new Date();
  today.setMonth(today.getMonth() - 1);
  const year = today.getFullYear();
  const month = today.getMonth();
  
  const monthKey = `month_${year}-${(month + 1)
    .toString()
    .padStart(2, "0")}`;

  const monthData = JSON.parse(localStorage.getItem(monthKey) || "{}");

  if (Object.keys(monthData).length === 0) {
    showAlert("No hay datos para exportar en el mes anterior.", "warning");
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
  ];
  const rows = [headers];
  let totalMonthMinutes = 0;

  const daysInMonth = new Date(
    year,
    month + 1,
    0
  ).getDate();

  for (let i = 1; i <= daysInMonth; i++) {
    const day = new Date(year, month, i);
    const dayKey = `${year}-${(month + 1).toString().padStart(2, "0")}-${i.toString().padStart(2, "0")}`;
    const dayData = monthData[dayKey];
    const isFriday = day.getDay() === 5;

    const rowData = {
      Fecha: dayKey,
      Entrada: "",
      "Salida Comer": "",
      "Entrada Comer": "",
      Salida: "",
      Total: "",
      Diferencia: "",
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
      totalMonthMinutes += dayData.workedMinutes;

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
    rows.push(Object.values(rowData));
  }

  const totalHours = Math.floor(totalMonthMinutes / 60);
  const totalMins = totalMonthMinutes % 60;
  rows.push([
    "",
    "",
    "",
    "",
    "Total Mes",
    `${totalHours.toString().padStart(2, "0")}:${totalMins
      .toString()
      .padStart(2, "0")}`,
    "",
  ]);

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Jornada Mensual");

  const colWidths = headers.map((header, i) => ({
    wch:
      Math.max(
        header.length,
        ...rows.map((row) => (row[i] || "").toString().length)
      ) + 2,
  }));
  worksheet["!cols"] = colWidths;

  XLSX.writeFile(
    workbook,
    `jornada_mensual_${year}-${(month + 1)
      .toString()
      .padStart(2, "0")}.xlsx`
  );
}

function getWeekOfYear(date) {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  return 1 + Math.ceil((firstThursday - target) / 604800000);
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
