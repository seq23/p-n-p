// The ONE map of every button and link in the /admin console (owner's ask, 18 Oct 2026).
// The hover tooltip (title=""), the short visible line under a primary action, the numbered
// steps at the top of each screen and the "How to use this" page (/admin/help) all read from
// here, so they cannot drift. validate:admin-tooltips renders every view and fails if a
// <button>, link, toggle or upload button lacks data-help + the title from this map, or if
// any entry here is missing from the help page.
import { esc } from './util.mjs';

// Screens in the order the help page lists them.
export const SCREENS = [
  ['every', 'On every screen'],
  ['requests', 'Requests'],
  ['card', 'A request card'],
  ['payment', 'Payment (on a request card and on an invoice)'],
  ['invoice', 'Invoice'],
  ['checklist', 'Checklist'],
  ['calendar', 'Calendar & Bookings'],
  ['day', 'A day (the Day sheet)'],
  ['returns', 'Mark returned (rental check-in)'],
  ['archive', 'Put away'],
  ['settings', 'Settings'],
  ['gcal', 'Link my Google Calendar'],
  ['help', 'This help page'],
  ['signin', 'Sign in'],
];

// The 1-2-3 at the top of each screen.
export const STEPS = {
  requests: ['Read new requests.', 'Send the invoice.', 'When they pay, mark it paid.'],
  calendar: ['Pick a request from the list.', 'Drag it onto a day (or tap Schedule).', 'Check the details and tap Save — the request is marked Scheduled.'],
  day: ['Read who is coming and what they need.', 'Tap Call to ring them.', 'Tap Change this booking if something moved.'],
  booking: ['Pick what kind of booking it is.', 'Check the day, name and phone.', 'Tap Save booking.'],
  move: ['Pick the new day.', 'Check it is the right booking.', 'Tap Move it.'],
  signin: ['Type the password.', 'Tap Sign in.', 'You stay signed in for 30 days.'],
  archive: ['These are finished requests.', 'Tap Bring back if you need one again.', 'Nothing here is ever deleted.'],
  invoices: ['Find the customer.', 'Tap their name to open the invoice.', 'Send it, or mark it paid.'],
  invoiceEdit: ['Check what goes into the total.', 'Pick how they pay and the due date.', 'Tap See it before sending.'],
  invoice: ['Send the invoice (email or text).', 'When money arrives, use the Payment box.', 'When the job is over, tap Done on the request.'],
  checklist: ['Walk through the event with the customer.', 'Tick boxes and type notes. It saves by itself.', 'Tap Create invoice when you are done.'],
  settings: ['Type your Zelle and Cash App.', 'Add your payment QR code.', 'Tap Save.'],
  gcal: ['Tap Copy link.', 'On a computer, open Google Calendar and add it From URL.', 'Wait a few hours for Google to show it.'],
  returns: ['Tick every item that came back.', 'Note anything missing or damaged, and add a photo.', 'Tap Save: it is returned.'],
  search: ['Type part of a name, a phone number or an email.', 'Read their bookings and what they paid.', 'Tap Open to go to one.'],
  checklistPrint: ['Tap Print.', 'Take the paper to the visit and fill it in by hand.', 'Or tap Open online checklist to fill it in on your phone.'],
  notfound: ['This page does not exist.', 'Tap Back to requests.', 'Or tap How to use this at the top.'],
  help: ['Find the screen you are on.', 'Read what each button does.', 'Tap Print this page to keep a paper copy.'],
};

const H = (screen, label, title, helper, more, warn = '') => ({ screen, label, title, helper, more, warn });

export const HELP = {
  // On every screen
  'nav.brand': H('every', 'Porch & Party', 'Goes back to the list of requests.', '', 'The name at the very top. Tap it any time to get back to Requests.'),
  'nav.requests': H('every', 'Requests', 'Shows the new requests people sent from the website form.', '', 'The main list. New requests from the website form show up here within a minute.'),
  'nav.calendar': H('every', 'Calendar & Bookings', 'Shows every booking for all four services, as a month or as a list.', '', 'Porch decorating, party decor, grazing tables and game rentals, all in one place.'),
  'nav.archive': H('every', 'Put away', 'Shows the finished requests you put away.', '', 'Finished requests live here. You can bring any of them back.'),
  'nav.invoices': H('every', 'Invoices', 'Shows every invoice you have made, newest first.', '', 'A list of all invoices with their status and total.'),
  'nav.settings': H('every', 'Settings', 'Opens your payment details, password and calendar link.', '', 'Your Zelle, Cash App, QR code, password and the Google Calendar link.'),
  'nav.help': H('every', 'How to use this', 'Opens a one-page guide to every button. You can print it.', '', 'This page. Every button in the console is explained here.'),
  'nav.signout': H('every', 'Sign out', 'Signs this phone or computer out of the console.', '', 'Use it on a shared computer. You will need the password to get back in.'),
  'nav.back': H('every', 'Back', 'Goes back to the screen you came from.', '', 'Every screen has a Back link at the top. It never changes anything.'),
  'settings.open': H('every', 'Open Settings', 'Opens Settings so you can add your Zelle, Cash App and QR code.', 'Customers need these to pay you.', 'Shows up in a yellow box when your payment details are missing.'),

  // Requests screen
  'sub.blankInvoice': H('requests', 'Start a blank invoice', 'Makes a new empty invoice for a customer who did not use the website form.', 'For someone who called or texted you.', 'Use it when a customer called or texted instead of filling in the form. You type everything in.'),
  'sub.blankChecklist': H('requests', 'Print a blank checklist', 'Opens an empty walk-through checklist you can print on paper.', 'A paper copy to take to a visit.', 'Opens the four-page checklist with nothing filled in, ready to print.'),
  'sub.refresh': H('requests', 'Check for new requests now', 'Reloads the list straight from the Google Sheet, so a brand-new request shows up.', 'Use it if you are waiting for someone.', 'The list already updates every minute. This button asks the Google Sheet right now.'),
  'sub.today': H('requests', "Today's list", "Opens today's Day sheet: every booking today, what to load and what to collect.", 'Print it or text it to yourself.', 'The same page as tapping today on the calendar.'),
  'sub.find': H('requests', 'Find a customer', 'Opens the search to find any customer by name, phone or email.', 'Past, upcoming and put-away customers.', 'Searches every booking and every request.'),
  'req.sheet': H('requests', 'Open responses sheet', 'Opens the Google Sheet where every website request is saved.', '', 'The Google Sheet behind the list. You never need to change it.'),
  'req.idFolder': H('requests', 'Open ID folder', 'Opens the Google Drive folder with the photo IDs every customer uploaded.', '', 'The folder in Google Drive that holds every photo ID from the form.'),
  'req.undo': H('requests', 'Undo', 'Puts the request you just put away back on the list.', '', 'Shows for 6 seconds after you tap Done — put away, in case you tapped it by mistake.'),

  // A request card
  'card.checklist': H('card', 'Open checklist', 'Opens the walk-through checklist for this customer. It saves by itself.', 'Fill it in during a visit or call.', 'The checklist on your phone. Tick boxes and type notes; it saves as you go.'),
  'card.createInvoice': H('card', 'Create invoice', 'Makes an invoice for this customer with the prices already filled in.', 'Prices are filled in for you.', 'Starts an invoice from what they asked for. You can check it before it goes out.'),
  'card.openInvoice': H('card', 'Open invoice', 'Opens the invoice you already made for this customer.', 'Send it, resend it, or see if it is paid.', 'Shows once an invoice exists for the request.'),
  'card.printChecklist': H('card', 'Print checklist', 'Opens this customer\'s checklist, filled in so far, ready to print.', '', 'The paper version of the checklist, with their answers already on it.'),
  'card.archive': H('card', 'Done — put away', 'Takes this finished request off the list and keeps it under Put away.', 'Nothing is deleted. You can bring it back.', 'Use it when the job is over (or voided). The request moves to Put away. Nothing is deleted and the Google Sheet is not touched.'),
  'card.schedule': H('card', 'Put on the calendar', 'Opens a scheduling screen filled in from this request, so you can pick the day and save it.', 'Pick the day; the request is marked Scheduled.', 'Name, phone, what they asked for and the date they asked for are filled in. Change anything, then tap Save booking.'),
  'card.jobDone': H('card', 'Mark job done', 'Records that the porch, party or grazing job is over.', 'Then mark it paid in full when the money is in.', 'Rentals use Mark returned instead. The card then shows step 5, Job done.'),
  'card.undoJobDone': H('card', 'Undo job done', 'Takes back Job done if you tapped it by mistake.', '', ''),
  'card.seeCal': H('card', 'See it on the calendar', 'Opens the calendar day this request is booked on.', '', 'Shows on a card once it is scheduled.'),
  'card.details': H('card', 'Show phone, email, ID and all answers', 'Opens everything this customer typed into the form.', '', 'Their phone, email, date of birth, social media, photo ID and every answer.'),
  'card.phone': H('card', 'Phone number', 'Calls this customer from your phone.', '', 'Tap the number to ring them.'),
  'card.email': H('card', 'Email address', 'Starts an email to this customer.', '', 'Tap it to write to them from your email app.'),
  'card.social': H('card', 'Social media link', 'Opens the social media page they gave on the form.', '', 'A quick way to check who they are.'),
  'card.idPhoto': H('card', 'Open ID photo', 'Opens the photo ID this customer uploaded.', '', 'Their photo ID from the form, in Google Drive.'),

  // Payment
  'pay.deposit': H('payment', 'Mark deposit received', 'Records that the deposit is in your account. It asks you to be sure first.', 'Only after the deposit is in your account.', 'Tap it, read the question, then tap Yes. The status changes to Deposit paid.', 'Money: only do this after the money is in your account.'),
  'pay.depositYes': H('payment', 'Yes, mark deposit received', 'Saves that the deposit arrived.', '', 'The second tap that makes Mark deposit received happen.', 'Money: only after the money is in your account.'),
  'pay.paid': H('payment', 'Mark paid in full', 'Records that the whole amount is in your account. It asks you to be sure first.', 'Only after all the money is in your account.', 'Tap it, read the question, then tap Yes. The status changes to Paid.', 'Money: only do this after the money is in your account.'),
  'pay.paidYes': H('payment', 'Yes, mark paid in full', 'Saves that the whole amount arrived.', '', 'The second tap that makes Mark paid in full happen.', 'Money: only after the money is in your account.'),
  'pay.unpaid': H('payment', 'That was a mistake: mark as not paid', 'Undoes a payment you marked by mistake.', '', 'Puts the status back to not paid. It asks you to be sure first.', 'Money: use only to fix a mistake.'),
  'pay.unpaidYes': H('payment', 'Yes, mark as not paid', 'Saves that this customer has not paid yet.', '', 'The second tap that undoes a payment.', 'Money: use only to fix a mistake.'),
  'pay.void': H('payment', 'Void', 'Cancels this request or invoice. The customer is not told. It asks you to be sure first.', 'When the job is cancelled or the invoice was a mistake.', 'A voided invoice keeps its number, cannot be sent or marked paid, gets a big VOID stamp, and its bookings leave the calendar.', 'Voiding takes the bookings off your calendar. You can bring it back.'),
  'pay.voidYes': H('payment', 'Yes, void it', 'Voids it now. The customer is not told.', '', 'The second tap that makes Void happen.', 'Its bookings leave the calendar.'),
  'pay.unvoid': H('payment', 'Bring back (undo Void)', 'Undoes Void. An invoice comes back as not sent yet.', '', 'Use it if you voided something by mistake. Send the invoice again afterwards so it is back on the calendar.'),
  'pay.no': H('payment', 'No, go back', 'Closes the question without changing anything.', '', 'Every money or delete question has this button. It changes nothing.'),

  // Invoices list and invoice screens
  'inv.row': H('invoice', 'Customer name (on the Invoices list)', 'Opens this invoice.', '', 'Each name on the Invoices list opens that invoice.'),
  'ed.preview': H('invoice', 'See it before sending', 'Saves the invoice and shows you the exact email the customer will get. Nothing is sent.', 'Nothing is sent yet.', 'The safe button. You see the email first, then send it.'),
  'ed.sendNow': H('invoice', 'Send to (name) now', 'Saves the invoice and emails it to the customer straight away.', 'Sends the email right now.', 'Skips the preview and sends at once.', 'The customer gets the email immediately.'),
  'ed.change': H('invoice', 'Change what goes into the total', 'Opens the lines, prices and customer details so you can change them.', '', 'Change a price, add or remove a line, or fix the name, email or phone.'),
  'ed.addLine': H('invoice', 'Add a line', 'Adds one more thing to charge for.', '', 'Adds an empty line. Type what it is and the price.'),
  'ed.removeLine': H('invoice', 'Remove this line', 'Takes this line off the invoice.', '', 'Removes one line. Nothing is saved until you tap a Save or Send button.'),
  'ed.saveOnly': H('invoice', 'Save without sending', 'Saves your changes and does not send anything.', '', 'Keeps the invoice as a draft.'),
  'iv.send': H('invoice', 'Send invoice to (name)', 'Emails this invoice to the customer now.', 'A copy also goes to hello@porchandparty901.com.', 'The main button on a new invoice.', 'The customer gets the email immediately.'),
  'iv.text': H('invoice', 'Text the invoice (PDF)', 'Opens your phone\'s share menu with the invoice PDF and a short message, so you can text it.', 'For customers you reach by text.', 'Pick Messages, then the customer. On a computer it downloads the PDF instead.'),
  'iv.texted': H('invoice', 'Mark as sent by text', 'Records that you texted the invoice, so the list shows it as sent.', 'Tap after you texted the PDF.', 'Use after Text the invoice (PDF). It does not send anything by itself.'),
  'iv.resend': H('invoice', 'Resend', 'Emails the same invoice to the customer again.', 'If they lost the email.', 'Sends the invoice email again. Nothing else changes.', 'The customer gets the email again.'),
  'iv.more': H('invoice', 'More options', 'Shows less common things: change the invoice, see the email, the PDF, a test copy, mark done.', '', 'Nothing about money is in here. Payments are in the Payment box.'),
  'iv.edit': H('invoice', 'Change the invoice', 'Opens the invoice so you can change lines, prices or the due date.', '', 'Change anything, then save or send again.'),
  'iv.seeEmail': H('invoice', 'See the email', 'Opens the invoice email in a new tab, exactly as the customer sees it.', '', 'A look only. Nothing is sent.'),
  'iv.downloadPdf': H('invoice', 'Download the PDF', 'Saves the invoice as a PDF file on this phone or computer.', '', 'For printing or attaching somewhere yourself.'),
  'iv.openPdf': H('invoice', 'Open the PDF', 'Opens the invoice PDF in a new tab.', '', 'A look at the PDF the customer gets by text.'),
  'iv.test': H('invoice', 'Send a test copy to hello@porchandparty901.com', 'Sends a TEST copy to your own inbox only. The customer gets nothing.', '', 'Check how the email looks without bothering the customer.'),
  'iv.done': H('invoice', 'Job finished (mark done)', 'Marks the job as finished.', '', 'Use after the event is over and everything came back.'),
  'iv.copySms': H('invoice', 'Copy the message', 'Copies the text message so you can paste it into Messages.', '', 'Handy if the share button does not work on your phone.'),

  // Checklist
  'cl.addPhotos': H('checklist', 'Add photos', 'Takes or picks photos of the space and saves them with this checklist.', 'Up to 10 photos.', 'Photos shrink on your phone before they upload.'),
  'cl.photo': H('checklist', 'A photo', 'Opens this photo full size in a new tab.', '', 'Tap any photo to see it bigger.'),
  'cl.deletePhoto': H('checklist', 'Delete (photo)', 'Deletes this one photo. It asks you to be sure first.', '', 'Removes a walk-through photo.', 'Delete cannot be undone.'),
  'cl.section': H('checklist', 'Checklist page (Page 1, Page 2...)', 'Opens or closes this page of the checklist.', '', 'Tap a page title to see its questions.'),
  'cl.printNow': H('checklist', 'Print', 'Prints this checklist.', '', 'On the paper checklist page. Prints four pages.'),
  'cl.openOnline': H('checklist', 'Open online checklist', 'Opens the same checklist as a form on your phone.', '', 'On the paper checklist page, for filling it in on screen instead.'),

  // Calendar
  'cal.prev': H('calendar', 'Previous month', 'Shows the month before.', '', 'Moves the calendar back one month.'),
  'cal.next': H('calendar', 'Next month', 'Shows the month after.', '', 'Moves the calendar forward one month.'),
  'cal.today': H('calendar', 'This month', 'Jumps back to the current month.', '', 'Brings you back to today.'),
  'cal.day': H('calendar', 'A day (on the calendar or the Upcoming list)', 'Opens this day with every booking, the customer, what and where.', '', 'Tap any day to see its bookings and call the customer.'),
  'cal.schedule': H('calendar', 'Schedule', 'Opens the scheduling screen for this request so you can pick its day.', '', 'On each request in the Unscheduled requests list. On a computer you can also drag the request onto a day.'),
  'cal.unscheduled': H('calendar', 'Unscheduled request (drag onto a day)', 'Drag this request onto a day to schedule it there, or tap Schedule.', '', 'On a computer, hold the mouse button on a request and drop it on a day. The scheduling screen opens for that day.'),
  'cal.booking': H('calendar', 'Booking on a day (drag to move)', 'Opens this day. On a computer, drag the booking to another day to move it.', '', 'Dragging asks you to confirm the move before anything changes.'),
  'bk.move': H('calendar', 'Move to another day', 'Opens a date picker to move this booking to a different day.', '', 'For phones and keyboards; on a computer you can also drag it.'),
  'bk.moveYes': H('calendar', 'Move it', 'Moves the booking to the day you picked.', '', 'Shows on the admin Calendar at once and in Google Calendar after Google refreshes.'),
  'cal.viewMonth': H('calendar', 'Month', 'Shows the bookings on a month calendar.', '', 'Your phone remembers whether you last used Month or List.'),
  'cal.viewList': H('calendar', 'List', 'Shows every booking as one list, soonest first.', '', 'Tap Show past bookings to see the old ones too.'),
  'cal.past': H('calendar', 'Show past bookings', 'Shows (or hides) bookings that are already over.', '', 'On the List view.'),
  'find.box': H('calendar', 'Find a customer — type a name', 'Type part of a name, phone number or email; results show as you type.', '', 'Capital letters and accents do not matter. Put-away and void customers are shown and labelled.'),
  'find.go': H('calendar', 'Find', 'Searches for the customer you typed.', '', 'Results also appear by themselves as you type.'),
  'find.open': H('calendar', 'Open (a search result)', 'Opens this booking or request.', '', 'Goes to the day, or to the request.'),
  'rem.text': H('calendar', 'Text reminder', 'Opens Messages with a friendly reminder for this customer already typed in.', 'Check it, then tap Send in Messages.', 'Tapping it also marks the reminder as sent. Reminders only talk about the booking, as your terms allow.'),
  'rem.email': H('calendar', 'Email reminder', 'Opens your email app with the reminder typed in, for customers with no phone.', '', 'Only shows when there is no phone on file.'),
  'rem.mark': H('calendar', 'Mark reminded', 'Records that you reminded this customer, so the row says Reminder sent.', '', 'Use it if you reminded them some other way.'),
  'cal.add': H('calendar', 'Add a booking', 'Adds a booking by hand, for jobs that came by phone or text.', 'For bookings that came by phone.', 'Bookings from invoices appear by themselves. Use this for everything else.'),
  'cal.link': H('calendar', 'Link my Google Calendar', 'Shows how to put these bookings into your Google Calendar.', 'One time setup, on a computer.', 'Step-by-step instructions and a Copy link button.'),
  'day.call': H('calendar', 'Call', 'Calls this customer from your phone.', '', 'Big button on each booking for the day.'),
  'day.edit': H('calendar', 'Change this booking', 'Opens this booking so you can change the day, time or details.', '', 'Your changes stay even if the invoice is sent again.'),
  'day.delete': H('calendar', 'Delete this booking', 'Removes this booking from the calendar. It asks "Are you sure?" first.', '', 'Takes one booking off the calendar and Google Calendar. If it was the request\'s last booking, the request goes back to the status it had before it was scheduled.', 'Delete cannot be undone.'),
  'day.deleteYes': H('calendar', 'Yes, delete it', 'Deletes the booking now.', '', 'The second tap that makes Delete happen.', 'Delete cannot be undone.'),
  'day.print': H('day', 'Print this list', 'Prints the Day sheet on one page in large type, without the buttons.', '', 'Take it with you in the car.'),
  'day.textMe': H('day', 'Text it to me', 'Opens Messages with a short version of the day list addressed to your own phone.', '', 'Your number is set in Settings, under My day list. A long day ends with a link to the full list.'),
  'day.emailMe': H('day', 'Email it to me', 'Emails the full day list to your own email address.', '', 'The address is set in Settings, under My day list.'),
  'note.add': H('day', 'Add a note', 'Opens a big box to write a note on this booking, like a gate code.', 'Only you see notes.', 'Notes never go to the customer. They show on the Day sheet and in your Google Calendar.'),
  'note.edit': H('day', 'Change this note', 'Opens this note so you can fix it or delete it.', '', ''),
  'note.save': H('day', 'Save note', 'Saves the note.', '', 'It is kept even if the booking moves to another day.'),
  'note.delete': H('day', 'Delete this note', 'Deletes this note. It asks "Are you sure?" first.', '', '', 'Delete cannot be undone.'),
  'note.deleteYes': H('day', 'Yes, delete the note', 'Deletes the note now.', '', '', 'Delete cannot be undone.'),
  'ret.mark': H('returns', 'Mark returned', 'Opens the check-in for this rental: tick each item that came back.', 'When the games come back.', 'Shows on the request card, on the Rental return booking and on Overdue returns.'),
  'ret.see': H('returns', 'See the check-in', 'Opens the check-in you saved for this rental.', '', 'Change it, or undo it.'),
  'ret.allGood': H('returns', 'Everything came back in good shape', 'Ticks every item as back and not damaged.', 'The quick way when nothing is wrong.', ''),
  'ret.save': H('returns', 'Save: it is returned', 'Saves the check-in and marks the rental as returned.', '', 'If anything is missing or damaged the request reads Returned — check damage, with a reminder about the damage deposit. No money moves by itself.'),
  'ret.undo': H('returns', 'Undo returned', 'Puts the rental back to not returned. It asks you to be sure first.', '', 'The request gets back the status it had.'),
  'ret.undoYes': H('returns', 'Yes, undo returned', 'Undoes the check-in now.', '', ''),
  'bk.save': H('calendar', 'Save booking', 'Saves this booking on the calendar.', '', 'It shows on the admin Calendar at once, and in Google Calendar after Google refreshes.'),

  // Put away
  'pa.bringBack': H('archive', 'Bring back', 'Puts this request back on the Requests list.', '', 'Use it if a finished customer needs something again.'),

  // Settings
  'set.save': H('settings', 'Save', 'Saves your payment details. They go on every invoice.', '', 'Saves Zelle, Cash App, the QR code and the business details.'),
  'set.business': H('settings', 'Business name and address', 'Opens the business name, address and ID folder link.', '', 'Rarely needed. These print on invoices.'),
  'set.password': H('settings', 'Change password (open)', 'Opens the boxes to change the console password.', '', 'You need the current password.'),
  'set.passwordSave': H('settings', 'Change password', 'Saves the new password and signs out every other phone or computer.', '', 'Write the new password down somewhere safe.', 'Every other device is signed out.'),
  'set.saveDayList': H('settings', 'Save my day list details', 'Saves the phone number and email your day list is sent to.', '', 'Used by Text it to me and Email it to me on the Day sheet.'),
  'set.newToken': H('settings', 'Make a new private calendar link', 'Replaces your Google Calendar link with a new one. It asks you to be sure first.', '', 'Only if the link was shared by mistake.', 'Google Calendar stops updating until you link the new one.'),
  'set.newTokenYes': H('settings', 'Yes, make a new link', 'Makes the new link now. The old one stops working.', '', 'The second tap for a new calendar link.', 'You must add the new link to Google Calendar again.'),

  // Link my Google Calendar
  'gl.copy': H('gcal', 'Copy link', 'Copies your private calendar link so you can paste it into Google Calendar.', 'Then paste it into Google Calendar.', 'Copies the link. Keep it private: anyone with it can see your bookings.'),
  'gl.open': H('gcal', 'Open Google Calendar (From URL)', 'Opens Google Calendar on the page where you paste the link.', 'Best on a computer.', 'Goes straight to Other calendars, From URL.'),

  // Help
  'help.print': H('help', 'Print this page', 'Prints this guide.', '', 'Keep a paper copy by the phone.'),

  // Sign in
  'login.submit': H('signin', 'Sign in', 'Signs you in with the console password.', '', 'Type the password, then tap Sign in. You stay signed in for 30 days.'),
};

// Attributes for one element: data-help="key" title="one plain sentence".
export function tip(key) {
  const entry = HELP[key];
  if (!entry) throw new Error(`helptext: no entry for ${key}`);
  return ` data-help="${esc(key)}" title="${esc(entry.title)}"`;
}

// The short visible line under a primary action (phones have no hover).
export function hint(key) {
  const entry = HELP[key];
  if (!entry) throw new Error(`helptext: no entry for ${key}`);
  return entry.helper ? `<p class="hint" data-hint="${esc(key)}">${esc(entry.helper)}</p>` : '';
}

export function stepsBar(screen) {
  const steps = STEPS[screen];
  if (!steps) throw new Error(`helptext: no steps for ${screen}`);
  return `<ol class="topsteps" data-steps="${esc(screen)}">${steps.map((s, i) => `<li><span class="n">${i + 1}</span><span>${esc(s)}</span></li>`).join('')}</ol>`;
}

// The every-button section of /admin/help, grouped by screen, generated from HELP.
export function helpGlossary() {
  return SCREENS.map(([screen, name]) => {
    const entries = Object.entries(HELP).filter(([, e]) => e.screen === screen);
    if (!entries.length) return '';
    return `<section class="card gloss"><h2>${esc(name)}</h2><dl>${entries.map(([key, e]) => `<div class="g" data-help-entry="${esc(key)}"><dt><strong>${esc(e.label)}</strong></dt>
      <dd>${esc(e.title)}${e.more && e.more !== e.title ? ` ${esc(e.more)}` : ''}${e.warn ? `<div class="gwarn">Careful: ${esc(e.warn)}</div>` : ''}</dd></div>`).join('')}</dl></section>`;
  }).join('');
}
