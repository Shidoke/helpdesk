const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  subject: {
    type: String,
    required: [true, 'Тема обязательна'],
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: [true, 'Описание обязательно'],
    maxlength: 2000
  },
  requester: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    initials: String
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Critical'],
    default: 'Medium'
  },
  status: {
    type: String,
    enum: ['Open', 'Pending', 'Resolved', 'Closed'],
    default: 'Open'
  },
  assignee: {
    name: { type: String, default: 'Unassigned' },
    initials: { type: String, default: 'UN' }
  },
  category: {
    type: String,
    enum: ['Hardware', 'Software', 'Network', 'Account', 'Other'],
    default: 'Other'
  },
  comments: [{
    text: String,
    author: String,
    createdAt: { type: Date, default: Date.now }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Автообновление updatedAt
ticketSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Виртуальное поле для инициалов
ticketSchema.virtual('requesterInitials').get(function() {
  if (this.requester.initials) return this.requester.initials;
  return this.requester.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .substring(0, 2);
});

module.exports = mongoose.model('Ticket', ticketSchema);