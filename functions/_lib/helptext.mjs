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
  ['holds', 'Held games (rental holds)'],
  ['messages', 'Texts and emails to customers'],
  ['money', 'Money'],
  ['archive', 'Put away (at the bottom of Requests)'],
  ['settings', 'Settings'],
  ['gcal', 'Link my Google Calendar'],
  ['help', 'This help page'],
  ['signin', 'Sign in'],
];

// The 1-2-3 at the top of each screen.
export const STEPS = {
  requests: ['See who\'s asking.', 'Send a quote or invoice.', 'Plan your day and get paid.'],
  calendar: ['See what\'s coming up.', 'Put a request on the calendar.', 'Plan your day.'],
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
  money: ['See who still owes you.', 'See what came in this month.', 'Keep receipts for taxes.'],
  moneyDetail: ['Read the payments or jobs behind the total.', 'Tap a name to open it.', 'Tap Back to Money when done.'],
  expense: ['Take a photo of the receipt (or pick one).', 'Check what the computer read — fix anything wrong.', 'Tap Save.'],
  year: ['Pick the year.', 'Download the PDF and the spreadsheet, or email them to yourself.', 'Give them to your tax preparer.'],
  confirmed: ['Their deposit is in: the booking is confirmed.', 'Tap Text them it\'s confirmed (or Email them).', 'Tap Done.'],
  help: ['Find the screen you are on.', 'Read what each button does.', 'Tap Print this page to keep a paper copy.'],
  packages: ['Find the season (fall or Christmas).', 'Read what each package includes and where its price starts.', 'Use it as the starting price on the invoice, then adjust after the walk-through.'],
};

const H = (screen, label, title, helper, more, warn = '') => ({ screen, label, title, helper, more, warn });

export const HELP = {
  // On every screen
  'nav.brand': H('every', 'Porch & Party', 'Goes back to the list of requests.', '', 'The name at the very top. Tap it any time to get back to Requests.'),
  'nav.requests': H('every', 'Requests', 'Shows the new requests people sent from the website form.', '', 'The main list. New requests from the website form show up here within a minute.'),
  'nav.calendar': H('every', 'Calendar & Bookings', 'Shows every booking for all four services, as a month or as a list.', '', 'Porch decorating, party decor, grazing tables and game rentals, all in one place.'),
  'nav.money': H('every', 'Money', 'Shows money received, what is still owed, expenses and the year-end summary for taxes.', '', 'Month by month, in plain numbers.'),
  'nav.settings': H('every', 'Settings', 'Opens your payment details, password and calendar link.', '', 'Your Zelle, Cash App, QR code, password and the Google Calendar link.'),
  'nav.help': H('every', 'Help', 'Opens a one-page guide to every button. You can print it.', '', 'This page. Every button in the console is explained here.'),
  'nav.signout': H('every', 'Sign out', 'Signs this phone or computer out of the console.', '', 'Use it on a shared computer. You will need the password to get back in.'),
  'nav.back': H('every', 'Back', 'Goes back to the screen you came from.', '', 'Every screen has a Back link at the top. It never changes anything.'),
  'settings.open': H('every', 'Open Settings', 'Opens Settings so you can add your Zelle, Cash App and QR code.', 'Customers need these to pay you.', 'Shows up in a yellow box when your payment details are missing.'),

  // Requests screen
  'sub.blankInvoice': H('requests', 'Start a blank invoice', 'Makes a new empty invoice for a customer who did not use the website form.', 'For someone who called or texted you.', 'Use it when a customer called or texted instead of filling in the form. You type everything in.'),
  'sub.blankChecklist': H('requests', 'Print a blank checklist', 'Opens an empty walk-through checklist you can print on paper.', 'A paper copy to take to a visit.', 'Opens the four-page checklist with nothing filled in, ready to print.'),
  'sub.refresh': H('requests', 'Check for new requests', 'Reloads the list straight from the Google Sheet, so a brand-new request shows up.', 'Use it if you are waiting for someone.', 'The list already updates every minute. This button asks the Google Sheet right now.'),
  'sub.today': H('requests', "Today's list", "Opens today's Day sheet: every booking today, what to load and what to collect.", 'Print it or text it to yourself.', 'The same page as tapping today on the calendar.'),
  'sub.packages': H('requests', 'Porch packages', 'Opens the porch package prices for fall and Christmas: Stoop, Classic, Grand and Showstopper.', 'The same prices customers see on the website.', 'A reference grid with what each package includes and its starting price per season, plus the add-ons and the fall + Christmas bundle. It changes nothing.'),
  'sub.find': H('requests', 'Find a customer', 'Opens the search to find any customer by name, phone or email.', 'Past, upcoming and put-away customers.', 'Searches every booking and every request.'),
  'req.sheet': H('requests', 'Open responses sheet', 'Opens the Google Sheet where every website request is saved.', '', 'The Google Sheet behind the list. You never need to change it.'),
  'req.idFolder': H('requests', 'Open ID folder', 'Opens the Google Drive folder with the photo IDs every customer uploaded.', '', 'The folder in Google Drive that holds every photo ID from the form.'),
  'req.undo': H('requests', 'Undo', 'Puts the request you just put away back on the list.', '', 'Shows for 6 seconds after you tap Done — put away, in case you tapped it by mistake.'),

  // A request card
  'card.checklist': H('card', 'Open checklist', 'Opens the walk-through checklist for this customer. It saves by itself.', 'Fill it in during a visit or call.', 'The checklist on your phone. Tick boxes and type notes; it saves as you go.'),
  'card.createInvoice': H('card', 'Create invoice', 'Makes an invoice for this customer with the prices already filled in.', 'Prices are filled in for you.', 'Starts an invoice from what they asked for. You can check it before it goes out.'),
  'card.openInvoice': H('card', 'Open invoice', 'Opens the invoice you already made for this customer.', 'Send it, resend it, or see if it is paid.', 'Shows once an invoice exists for the request.'),
  'card.printChecklist': H('card', 'Print checklist', 'Opens this customer\'s checklist, filled in so far, ready to print.', '', 'The paper version of the checklist, with their answers already on it.'),
  'card.archive': H('card', 'Done — put away', 'Takes this finished request off the list and keeps it under Put away.', 'Nothing is deleted. You can bring it back.', 'Shows only once the job is Finished (done and paid in full) or Void. The request moves to Put away. Nothing is deleted and the Google Sheet is not touched.'),
  'card.jobDone': H('card', 'Mark job done', 'Records that the porch, party or grazing job is over.', 'Then mark it paid in full when the money is in.', 'Rentals use Mark returned instead. The card then shows step 5, Job done.'),
  'card.undoJobDone': H('card', 'Undo job done', 'Takes back Job done if you tapped it by mistake.', '', ''),
  'card.seeCal': H('card', 'See it on the calendar', 'Opens the calendar day this request is booked on.', '', 'Shows on a card once it is scheduled.'),
  'card.details': H('card', 'Show details', 'Opens everything this customer typed into the form, their ID, the checklist, the history, the less-used buttons and Void.', '', 'Their phone, email, date of birth, social media, photo ID, every answer, the checklist and what happened so far. The less-used buttons wait here too (a card shows at most three besides the big one), and Void this request… is the small red link at the bottom.'),
  'card.call': H('card', 'Call', 'Calls this customer from your phone.', '', 'On the key-facts line under their name, with the date and where.'),
  'card.schedInstall': H('card', 'Schedule install', 'Opens the scheduling screen for the porch install, filled in from this request.', 'Pick the day; the request is marked Scheduled.', 'The first step for a porch. The takedown comes after; when the customer asked for one, the job is Finished only once the takedown is done.'),
  'card.schedSetup': H('card', 'Schedule setup', 'Opens the scheduling screen for the party or grazing setup, filled in from this request.', 'Pick the day; the request is marked Scheduled.', 'The first step for party decor and grazing tables.'),
  'card.schedPickup': H('card', 'Schedule pickup + return', 'Opens the scheduling screen for the game pickup, with the return day filled in from how long they rent.', 'The return day is filled in; you can change it.', 'Rentals always have a pickup and a return, booked as a pair.'),
  'card.schedTakedown': H('card', 'Schedule takedown', 'Opens the scheduling screen for the takedown after the porch or party, with the day they asked for filled in.', 'Nothing is booked until you save it.', 'When the customer asked for a takedown, the job is Finished only once the takedown is done (or the customer will handle it).'),
  'card.schedGrazingPickup': H('card', 'Schedule pickup (optional)', 'Opens the scheduling screen to collect the grazing table things after the event.', 'Optional. Never required to finish the job.', 'Shows once the grazing setup is on the calendar.'),
  'req.filter': H('requests', 'Filter (All, Porch, Party & decor, Grazing, Rentals, Not paid yet)', 'Shows only the requests for that service, or only the customers who still owe money.', '', 'The chips above the list. All shows everything again. The Put away section at the bottom follows the same filter.'),
  'pa.show': H('archive', 'Show put-away requests', 'Opens the list of requests you put away, at the bottom of Requests.', '', 'Closed until you tap it. Each one has Bring back.'),
  'np.call': H('money', 'Call (Not paid yet)', 'Calls this customer about what they still owe.', '', 'On each row of Not paid yet at the top of Money.'),
  'np.text': H('money', 'Text a reminder', 'Opens a text to this customer with the amount, the due date and the invoice number filled in.', '', 'It is sent from your own phone, so it is free. Read it before you tap send.'),
  'np.email': H('money', 'Email a reminder', 'Emails this customer a friendly reminder of what they owe, from hello@, at once.', '', 'One tap. The date it went out is shown on the row.'),
  'np.open': H('money', 'Open invoice (Not paid yet)', 'Opens this customer\'s invoice.', '', 'Send it again, or see every payment.'),
  'np.paid': H('money', 'Mark paid', 'Records that this customer has now paid everything they owe. It asks you first.', '', 'Use it only after the money is in your account.', 'This records money as received. Only tap Yes when the money is in your account.'),
  'np.filter': H('money', 'Not paid yet on Requests', 'Shows only the request cards of customers who still owe money.', '', 'The same list as the top of Money, as cards.'),
  'set.weeklyToggle': H('settings', 'Turn the Monday summary on / off', 'Switches the Monday 7 AM summary email on or off.', '', 'It is on unless you turn it off. It goes to your day-list email.'),
  'set.weeklyNow': H('settings', "Send me this week's summary now", 'Emails you this week\'s summary straight away.', 'Goes to your day-list email.', 'The same email as the automatic Monday one: last week, this week and what needs you.'),
  'td.schedule': H('card', 'Schedule it (takedown)', 'Opens the scheduling screen for the takedown after the porch or party.', '', 'Once a takedown is booked, the job is Finished only after you mark the takedown done.'),
  'td.requested': H('card', 'Takedown requested — tap to schedule', 'Opens the scheduling screen for the takedown the customer asked for, with their day filled in.', 'Nothing is booked until you save it.', 'The job is not Finished until the takedown is done, or you choose Customer will handle it.'),
  'td.markDone': H('card', 'Mark takedown done', 'Marks the takedown as done. With Job done and Paid in full, the request is Finished.', 'Shows from the takedown day.', 'Before the takedown day the card waits quietly. Undo it on the day sheet if you tapped it by mistake.'),
  'td.undoDone': H('calendar', 'Undo takedown done', 'Takes back Mark takedown done if you tapped it by mistake.', '', 'The request goes back to waiting for the takedown.'),
  'cal.tdToSchedule': H('calendar', 'Schedule it (Takedowns to schedule)', 'Opens the scheduling screen for a takedown the customer asked for, with their day filled in.', 'Nothing is booked until you save it.', 'Takedowns to schedule lists every porch or party whose customer asked for a takedown that is not on the calendar yet.'),
  'td.notSure': H('card', 'Not sure yet (takedown)', 'Saves that the takedown is not decided yet, with your note.', '', 'The card shows "Takedown: not decided yet" in amber, and it is listed under Still to decide on Calendar & Bookings.'),
  'td.customer': H('card', 'Customer will handle it', 'Saves that the customer takes the decor down themselves. No booking, no reminders.', '', 'Your note is kept with it. Tap Change if they change their mind.'),
  'td.change': H('card', 'Change (takedown)', 'Asks the takedown question again on this card.', '', 'Use it if the customer changed their mind.'),
  'td.jobDoneYes': H('card', 'Yes, mark job done', 'Marks the job done even though the takedown is not decided.', '', 'You can still schedule the takedown afterwards. The request is Finished only once the takedown is decided and done.'),
  'cal.decide': H('calendar', 'Schedule it (Still to decide)', 'Opens the scheduling screen for this takedown.', '', 'Still to decide lists every porch or party whose takedown is not decided yet.'),
  'cal.decideOpen': H('calendar', 'Open the request (Still to decide)', 'Opens Requests at this customer, to choose Customer will handle it or change the note.', '', ''),
  'money.invoices': H('money', 'All invoices', 'Shows every invoice you have made, newest first.', '', 'A list of all invoices with their status and total.'),
  'card.phone': H('card', 'Phone number', 'Calls this customer from your phone.', '', 'Tap the number to ring them.'),
  'card.email': H('card', 'Email address', 'Starts an email to this customer.', '', 'Tap it to write to them from your email app.'),
  'card.social': H('card', 'Social media link', 'Opens the social media page they gave on the form.', '', 'A quick way to check who they are.'),
  'hold.more': H('holds', 'Give them more time', 'Shows the ways to make this hold last longer.', '', 'Add 24 or 48 hours, or pick the exact day and time the hold should end. The change is written on the request.'),
  'hold.plus24': H('holds', '+24 hours', 'Makes this hold end 24 hours later.', '', 'Counted from the current end time (or from now, if it already ended). A new reminder goes out for the new end time.'),
  'hold.plus48': H('holds', '+48 hours', 'Makes this hold end 48 hours later.', '', 'Counted from the current end time (or from now, if it already ended).'),
  'hold.pick': H('holds', 'Hold until then', 'Makes this hold end at the day and time you picked.', '', 'Memphis time.'),
  'hold.keep': H('holds', "Keep holding — I'll handle it", 'Turns off the automatic end for this hold: it stays held until you release it.', '', 'It shows as "Held by hand" with no countdown. Use Release these games when you are done.'),
  'hold.release': H('holds', 'Release now', 'Ends this hold now, after asking you first: the games come off the calendar.', '', 'Others can book the games straight away. The request stays on the list.', 'The games are offered to others right away.'),
  'hold.releaseHand': H('holds', 'Release these games', 'Ends this held-by-hand hold, after asking you first.', '', 'The games come off the calendar and others can book them.', 'The games are offered to others right away.'),
  'hold.releaseYes': H('holds', 'Yes, release the games', 'Ends the hold now.', '', 'The games come off the calendar.', 'The games are offered to others right away.'),
  'hold.deposit': H('holds', 'Mark deposit received', 'Records the deposit, after asking you first, and turns the hold into a confirmed booking.', '', 'Only after the money is in your account. A confirmation email goes to the customer by itself.', 'Only after the money is in your account.'),
  'hold.depositYes': H('holds', 'Yes, mark deposit received', 'Records the deposit and confirms the booking.', '', 'The hold stops counting down.', 'Only after the money is in your account.'),
  'hold.text': H('holds', 'Text a reminder', 'Opens a text from your phone, already written, reminding them when their hold ends.', '', 'Free: it is your own phone. You just tap Send.'),
  'hold.email': H('holds', 'Email them', 'Emails them the same reminder now, from hello@porchandparty901.com.', '', 'One tap. They also get one by email by themselves a few hours before the hold ends (Settings).'),
  'hold.call': H('holds', 'Call', 'Calls them from your phone.', '', 'Their mobile number from the request.'),
  'conf.text': H('messages', "Text them it's confirmed", 'Opens a text from your phone saying their booking is confirmed, with the date and what is left to pay.', '', 'Free: it is your own phone. The card then shows "Confirmation sent".'),
  'conf.email': H('messages', 'Email them', 'Emails them the same confirmation now, from hello@porchandparty901.com.', '', 'The confirmation email also goes by itself when you mark the deposit received, only once.'),
  'conf.back': H('messages', 'Done', 'Goes back to where you were.', '', 'You can send the confirmation text later from the request card.'),
  'ty.text': H('messages', 'Text a thank-you', 'Opens a thank-you text from your phone, already written.', '', 'Optional. The thank-you email goes by itself the morning after you mark the job done.'),
  'ty.email': H('messages', 'Email it now', 'Sends the thank-you email right now instead of tomorrow morning.', '', 'It is only ever sent once.'),
  'ty.skip': H('messages', "Don't send a thank-you", 'Stops the automatic thank-you email for this request.', '', 'Tap Send the thank-you after all to change your mind.'),
  'ty.unskip': H('messages', 'Send the thank-you after all', 'Turns the automatic thank-you email back on for this request.', '', 'It goes out the next morning at about 10 AM.'),
  'msg.pickupText': H('messages', 'Text about pickup time', 'Opens a text from your phone asking what pickup time works for them.', 'Then put the time on the pickup booking.', 'Free: it is your own phone. Once the pickup booking has a time, the card waits quietly until pickup day.'),
  'msg.pickupEmail': H('messages', 'Email them', 'Emails them the same question now, from hello@porchandparty901.com.', '', 'One tap.'),
  'rem.emailNow': H('calendar', 'Email them', "Emails tomorrow's reminder now, from hello@porchandparty901.com.", '', 'The same words as the text. Customers with an email also get it by themselves at about 10 AM.'),
  'cal.viewHeld': H('calendar', 'Held', 'Shows every game rental hold waiting for a deposit, with its end time.', '', 'Holds kept by hand (no end time) are listed apart.'),
  'set.holds': H('settings', 'Save hold settings', 'Saves how long rentals are held and when the reminder goes out.', '', 'Changes apply to new holds; a hold already running keeps its end time.'),
  'card.idDelete': H('card', 'Delete this ID', "Deletes this customer's ID photo for good, after asking you first.", '', 'Use it once they have paid in full (and, for a game rental, brought the games back). The list "IDs ready to delete" on Requests shows who is ready. Nothing ever deletes an ID by itself. Every delete is logged with the time.', 'It cannot be undone.'),
  'card.idDeleteYes': H('card', 'Yes, delete the ID for good', 'Deletes the ID photo now. This cannot be undone.', '', 'For a request from the old Google Form, the photo also sits in the ID folder in Google Drive: delete it there by hand too.', 'It cannot be undone.'),
  'req.weekList': H('requests', "See this week's requests", 'Lists the requests that came in this week, Monday to Sunday.', '', 'The line above it counts every request sent this week by service, with last week next to it for comparison.'),
  'card.idPhoto': H('card', 'Open ID photo', 'Opens the photo ID this customer uploaded.', '', 'Their photo ID from the form, in Google Drive.'),

  // Payment
  'pay.deposit': H('payment', 'Mark deposit received', 'Records that the deposit is in your account. It asks you to be sure first.', 'Only after the deposit is in your account.', 'Tap it, read the question, then tap Yes. The status changes to Deposit paid.', 'Money: only do this after the money is in your account.'),
  'pay.depositYes': H('payment', 'Yes, mark deposit received', 'Saves that the deposit arrived.', '', 'The second tap that makes Mark deposit received happen.', 'Money: only after the money is in your account.'),
  'pay.paid': H('payment', 'Mark paid in full', 'Records that the whole amount is in your account. It asks you to be sure first.', 'Only after all the money is in your account.', 'Tap it, read the question, then tap Yes. The status changes to Paid.', 'Money: only do this after the money is in your account.'),
  'pay.paidYes': H('payment', 'Yes, mark paid in full', 'Saves that the whole amount arrived.', '', 'The second tap that makes Mark paid in full happen.', 'Money: only after the money is in your account.'),
  'pay.unpaid': H('payment', 'That was a mistake: mark as not paid', 'Undoes a payment you marked by mistake.', '', 'Puts the status back to not paid. It asks you to be sure first.', 'Money: use only to fix a mistake.'),
  'pay.unpaidYes': H('payment', 'Yes, mark as not paid', 'Saves that this customer has not paid yet.', '', 'The second tap that undoes a payment.', 'Money: use only to fix a mistake.'),
  'pay.void': H('payment', 'Void this request…', 'Cancels this request or invoice. The customer is not told. It asks you to be sure first.', 'When the job is cancelled or the invoice was a mistake.', 'A voided invoice keeps its number, cannot be sent or marked paid, gets a big VOID stamp, and its bookings leave the calendar.', 'Voiding takes the bookings off your calendar. You can bring it back.'),
  'pay.voidYes': H('payment', 'Yes, void it', 'Voids it now. The customer is not told.', '', 'The second tap that makes Void happen.', 'Its bookings leave the calendar.'),
  'pay.unvoid': H('payment', 'Bring back (undo Void)', 'Undoes Void. An invoice comes back as not sent yet.', '', 'Use it if you voided something by mistake. Send the invoice again afterwards so it is back on the calendar.'),
  'pay.no': H('payment', 'No, go back', 'Closes the question without changing anything.', '', 'Every money or delete question has this button. It changes nothing.'),

  // Invoices list and invoice screens
  'inv.row': H('invoice', 'Customer name (on the Invoices list)', 'Opens this invoice.', '', 'Each name on the Invoices list opens that invoice.'),
  'ed.preview': H('invoice', 'See it before sending', 'Saves the invoice and shows you the exact email the customer will get. Nothing is sent.', 'Nothing is sent yet.', 'The safe button. You see the email first, then send it.'),
  'ed.sendNow': H('invoice', 'Send to (name) now', 'Saves the invoice and emails it to the customer straight away.', 'Sends the email right now.', 'Skips the preview and sends at once.', 'The customer gets the email immediately.'),
  'ed.change': H('invoice', 'Change what goes into the total', 'Opens the lines, prices and customer details so you can change them.', '', 'Change a price, add or remove a line, or fix the name, email or phone.'),
  'ed.packages': H('invoice', 'See the porch packages', 'Opens the porch package prices in a new tab, so you can check a starting price while you write the invoice.', '', 'The same grid as Porch packages on Requests. A porch invoice already starts at the package the customer picked.'),
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

  // Money
  'mon.total': H('money', 'A total (Money received, Still owed, Jobs, a service...)', 'Shows the payments, jobs or expenses behind this number.', '', 'Every total on the Money tab can be tapped.'),
  'mon.prev': H('money', '‹ Previous', 'Shows the month before.', '', ''),
  'mon.this': H('money', 'This month', 'Jumps back to the current month.', '', ''),
  'mon.next': H('money', 'Next ›', 'Shows the month after.', '', ''),
  'mon.month': H('money', 'A month (in the 12-month list)', 'Opens that month.', '', 'The bar shows money received; the number is always written next to it.'),
  'mon.yearPrev': H('money', '‹ Last year', 'Shows the year before.', '', ''),
  'mon.yearNext': H('money', 'Next year ›', 'Shows the year after.', '', ''),
  'mon.taxes': H('money', 'Year-end summary for taxes', 'Opens the summary of the year for your tax preparer.', 'PDF, spreadsheet and receipts.', 'Money in by month, service and payment method, refunds, damage deposits, jobs, expenses and every invoice number. It is a summary, not tax advice.'),
  'exp.add': H('money', 'Add a receipt', 'Takes a photo of a receipt (or picks photos or PDFs) and reads it for you.', 'The computer reads it; you check it.', 'Nothing is saved until you tap Save. Low-confidence fields are outlined in amber.'),
  'exp.manual': H('money', 'Type it in instead', 'Opens an empty expense form to type in yourself.', '', 'For a receipt you do not have, or when the reader is busy.'),
  'exp.open': H('money', 'An expense (in the list)', 'Opens this expense so you can check, change or delete it.', '', ''),
  'exp.receipt': H('money', 'See the receipt', 'Opens the receipt picture or PDF.', '', 'Only you can see it, after signing in.'),
  'exp.save': H('money', 'Save (an expense)', 'Saves the expense so it counts in the Money totals.', '', 'An expense counts only after you save it.'),
  'exp.delete': H('money', 'Delete this expense', 'Deletes the expense and its receipt. It asks "Are you sure?" first.', '', '', 'Delete cannot be undone.'),
  'exp.deleteYes': H('money', 'Yes, delete the expense', 'Deletes it now.', '', '', 'Delete cannot be undone.'),
  'yr.pdf': H('money', 'Download PDF', 'Saves the year-end summary as a PDF to print or send.', '', ''),
  'yr.csv': H('money', 'Download spreadsheet (CSV)', 'Saves the summary and every invoice and expense as a spreadsheet file.', '', 'Opens in Excel or Google Sheets.'),
  'yr.email': H('money', 'Email it to me (year-end)', 'Emails the PDF and the spreadsheet to your own email address.', '', 'The address is set in Settings, under My day list.'),
  'yr.sheet': H('money', 'Write the Year tab in the Google Sheet', 'Writes this year\'s summary into a "Year" tab of your request sheet.', '', 'It never changes the form responses tab.'),
  'yr.zip': H('money', 'Download all receipts (zip)', 'Downloads every saved receipt for the year in one zip file.', '', 'Handy for your tax preparer.'),
  'dep.refund': H('payment', 'Refund the damage deposit', 'Records that you gave the damage deposit back. It asks you to be sure first.', 'Send the money yourself first.', 'It only records the refund; no money moves by itself.', 'Money: record it only after you sent it back.'),
  'dep.refundYes': H('payment', 'Yes, record the refund', 'Saves the refund.', '', '', 'Money: only after you sent it back.'),
  'dep.keep': H('payment', 'Keep some for damage', 'Records keeping part of the damage deposit because something was damaged.', '', 'It counts as income on the Money tab.', 'Money: tell the customer yourself.'),
  'dep.keepYes': H('payment', 'Yes, keep it for damage', 'Saves the amount kept.', '', '', 'Money: tell the customer yourself.'),

  // Put away
  'pa.bringBack': H('archive', 'Bring back', 'Puts this request back on the Requests list.', '', 'Use it if a finished customer needs something again.'),

  // Settings
  'set.save': H('settings', 'Save', 'Saves your payment details. They go on every invoice.', '', 'Saves Zelle, Cash App, the QR code and the business details.'),
  'set.business': H('settings', 'Business name and address', 'Opens the business name, address and ID folder link.', '', 'Rarely needed. These print on invoices.'),
  'set.password': H('settings', 'Change password (open)', 'Opens the boxes to change the console password.', '', 'You need the current password.'),
  'set.passwordSave': H('settings', 'Change password', 'Saves the new password and signs out every other phone or computer.', '', 'Write the new password down somewhere safe.', 'Every other device is signed out.'),
  'set.saveDayList': H('settings', 'Save my day list details', 'Saves the phone number and email your day list is sent to.', '', 'Used by Text it to me and Email it to me on the Day sheet.'),
  'set.sheetSync': H('settings', 'Update the Google Sheet now', 'Rewrites your Bookings, Monthly totals and Expenses tabs in the request sheet right now.', 'They also update by themselves.', 'It never touches the form responses tab.'),
  'set.categories': H('settings', 'Save categories', 'Saves your list of expense categories.', '', 'One per line. Other is always kept.'),
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

// The steps panel (Requests, Calendar & Bookings, Money): the same numbered 1-2-3, each step
// with a line and its buttons. 3 columns on a computer, stacked on a phone.
export const PANELS = {
  requests: ['New requests are listed below.', 'Open a request below and tap Create invoice — or, for someone who called or texted you:', 'When money comes in, tap Mark paid on that card.'],
  calendar: ['Every booking for all four services, by month or as a list.', 'Drag one from Unscheduled requests onto a day on a computer, or tap Schedule — or add one that came by phone:', 'Open a day to see who is coming, what to load and what to collect.'],
  money: ['Not paid yet is listed below, most overdue first.', 'Money received, still owed and jobs for the month you pick.', 'Snap each receipt; the year-end summary is ready for your tax preparer.'],
};
export function stepsPanel(screen, buttons = [[], [], []], small = ['', '', '']) {
  const steps = STEPS[screen];
  const lines = PANELS[screen];
  if (!steps || !lines) throw new Error(`helptext: no steps panel for ${screen}`);
  return `<ol class="topsteps stepspanel" data-steps="${esc(screen)}" data-steps-panel>${steps.map((s, i) => `<li><span class="n">${i + 1}</span><div class="sp"><strong class="spt">${esc(s)}</strong><p class="spl">${esc(lines[i])}</p>${buttons[i] && buttons[i].length ? `<div class="spb">${buttons[i].join('')}</div>` : ''}${small[i] ? `<p class="sps">${small[i]}</p>` : ''}</div></li>`).join('')}</ol>`;
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
