const VALID_CHOICES = [
  'Tomorrow (Saturday)',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Next Monday'
];

/**
 * Returns the label for "Works Planned" based on report date.
 * Mon–Thu always says "Tomorrow". Friday uses the dropdown value.
 */
function getWorksPlannedLabel(reportDate, dropdownChoice) {
  const date = new Date(reportDate);
  const dayOfWeek = date.getDay(); // 0=Sun, 5=Fri

  if (dayOfWeek !== 5) {
    return 'Tomorrow';
  }

  // Friday: honour the dropdown if it's a recognised value, default to Monday
  return VALID_CHOICES.includes(dropdownChoice) ? dropdownChoice : 'Monday';
}

module.exports = { getWorksPlannedLabel, VALID_CHOICES };
