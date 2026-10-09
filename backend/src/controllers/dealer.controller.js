import dealerService from '../services/dealer.service.js';
import logger from '../config/logger.js';

export const createDealer = async (req, res) => {
  try {
    const dealer = await dealerService.createDealer(req.body);
    res.status(201).json({ success: true, data: dealer });
  } catch (error) {
    logger.error('Create dealer error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getDealers = async (req, res) => {
  try {
    const { page, limit, search, region, city, isActive, assignedAgent, sort } = req.query;
    const result = await dealerService.getDealers({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      search, region, city, isActive, assignedAgent, sort,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Get dealers error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getDealerById = async (req, res) => {
  try {
    const dealer = await dealerService.getDealerById(req.params.id);
    res.json({ success: true, data: dealer });
  } catch (error) {
    logger.error('Get dealer error:', error);
    res.status(404).json({ success: false, message: error.message });
  }
};

export const updateDealer = async (req, res) => {
  try {
    const dealer = await dealerService.updateDealer(req.params.id, req.body);
    res.json({ success: true, data: dealer });
  } catch (error) {
    logger.error('Update dealer error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteDealer = async (req, res) => {
  try {
    await dealerService.deleteDealer(req.params.id);
    res.json({ success: true, message: 'Dealer deactivated' });
  } catch (error) {
    logger.error('Delete dealer error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getDealerSummary = async (req, res) => {
  try {
    const summary = await dealerService.getDealerSummary(req.params.id);
    res.json({ success: true, data: summary });
  } catch (error) {
    logger.error('Get dealer summary error:', error);
    res.status(404).json({ success: false, message: error.message });
  }
};

export const syncFromTally = async (req, res) => {
  try {
    const result = await dealerService.syncFromTally();
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Sync from Tally error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const syncSetu = async (req, res) => {
  try {
    const result = await dealerService.syncFromSetu();
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Sync from SETU error:', error);
    res.status(502).json({ success: false, message: error.message });
  }
};

export const syncOutstanding = async (req, res) => {
  try {
    const result = await dealerService.syncOutstandingFromTally();
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Sync outstanding error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getDealerStats = async (req, res) => {
  try {
    const stats = await dealerService.getDealerStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('Get dealer stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getRegions = async (req, res) => {
  try {
    const regions = await dealerService.getRegions();
    res.json({ success: true, data: regions });
  } catch (error) {
    logger.error('Get regions error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCities = async (req, res) => {
  try {
    const cities = await dealerService.getCities();
    res.json({ success: true, data: cities });
  } catch (error) {
    logger.error('Get cities error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateDealerLocation = async (req, res) => {
  try {
    const { latitude, longitude, address, city, region, area } = req.body;
    if (latitude == null || longitude == null) {
      return res.status(400).json({ success: false, message: 'latitude and longitude are required' });
    }
    const dealer = await dealerService.updateDealerLocation(req.params.id, { latitude, longitude, address, city, region, area });
    res.json({ success: true, data: dealer });
  } catch (error) {
    logger.error('Update dealer location error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

export const bulkUpdateLocations = async (req, res) => {
  try {
    const { locations } = req.body;
    if (!Array.isArray(locations) || locations.length === 0) {
      return res.status(400).json({ success: false, message: 'locations array is required' });
    }
    const result = await dealerService.bulkUpdateLocations(locations);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Bulk update locations error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};
